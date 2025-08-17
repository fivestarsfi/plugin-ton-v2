import {
    elizaLogger,
    composePromptFromState,
    parseKeyValueXml,
    ModelType,
    type IAgentRuntime,
    type Memory,
    type State,
    type HandlerCallback,
    Content,
} from "@elizaos/core";
import {
    Address,
    beginCell,
    internal,
    JettonMaster,
    SendMode,
    toNano,
} from "@ton/ton";
import { Builder } from "@ton/ton";
import {
    initWalletProvider,
    nativeWalletProvider,
    WalletProvider,
} from "../providers/wallet";
import {
    base64ToHex,
    sanitizeTonAddress,
    sleep,
    waitSeqnoContract,
} from "../utils/util";

export interface SingleTransferContent {
    type: "ton" | "token" | "nft";
    recipientAddress: string;
    amount?: string;
    tokenId?: string;
    jettonMasterAddress?: string;
    metadata?: string;
}

export type BatchTransferContent = SingleTransferContent[];

// Type alias for TransferItem (same as SingleTransferContent)
type TransferItem = SingleTransferContent;

interface Report {
    type: string;
    recipientAddress: string;
    amount?: string;
    tokenId?: string;
    status: string;
    error?: string;
}

interface ReportWithMessage {
    report: Report;
    message?: any;
}

// Type validation function for transfers
function isValidTransfer(transfer: any): transfer is SingleTransferContent {
    if (!transfer.type || !transfer.recipientAddress) return false;

    // TON transfers require an amount
    if (transfer.type === "ton" && !transfer.amount) return false;

    // Token transfers require jettonMasterAddress and amount
    if (
        transfer.type === "token" &&
        (!transfer.jettonMasterAddress || !transfer.amount)
    )
        return false;

    // NFT transfers require a tokenId
    if (transfer.type === "nft" && !transfer.tokenId) return false;

    return true;
}

const batchTransferTemplate = `Extract transfer details from the recent messages. Each transfer should specify type (ton, token, or nft), recipient address, and relevant details.

Rules:
- Each recipient address should appear only once per asset type
- Each token (jettonMasterAddress) should appear only once
- Each NFT (tokenId) should appear only once
- Do not create both NFT and token transfers for the same address
- Amounts are required for TON and token transfers
- JettonMasterAddress is required for token transfers
- TokenId is required for NFT transfers

Respond with each transfer in the following XML format:
<response>
<transfers>
<transfer1_type>ton|token|nft</transfer1_type>
<transfer1_recipientAddress>address</transfer1_recipientAddress>
<transfer1_amount>amount (if applicable)</transfer1_amount>
<transfer1_jettonMasterAddress>address (if token)</transfer1_jettonMasterAddress>
<transfer1_tokenId>id (if nft)</transfer1_tokenId>
<transfer2_type>ton|token|nft</transfer2_type>
<transfer2_recipientAddress>address</transfer2_recipientAddress>
... (continue pattern for more transfers)
</transfers>
</response>

{{recentMessages}}

Extract all transfer details and respond in the XML format above.`;

function isBatchTransferContent(content: any): content is BatchTransferContent {
    if (Array.isArray(content)) {
        return content.every((transfer) => isValidTransfer(transfer));
    }
    return isValidTransfer(content);
}

/**
 * Deduplicates transfer items based on type and relevant properties.
 * Rules:
 * - Keep only one TON transfer per recipient
 * - Keep only one token transfer per jettonMasterAddress
 * - Keep only one NFT transfer per tokenId
 * - Don't allow both NFT and token transfers for the same address
 */
function deduplicateTransfers(
    transfers: BatchTransferContent
): BatchTransferContent {
    const uniqueTransfers = new Map<string, SingleTransferContent>();
    const processedRecipients = new Map<string, Set<string>>();

    for (const transfer of transfers) {
        let key: string;

        // Initialize recipient's transfer types set if not exists
        if (!processedRecipients.has(transfer.recipientAddress)) {
            processedRecipients.set(transfer.recipientAddress, new Set());
        }
        const recipientTransfers = processedRecipients.get(
            transfer.recipientAddress
        )!;

        // Generate unique key and check conditions based on transfer type
        switch (transfer.type) {
            case "ton":
                key = `ton:${transfer.recipientAddress}`;
                break;
            case "token":
                if (
                    recipientTransfers.has("token") ||
                    recipientTransfers.has("nft")
                ) {
                    continue; // Skip if recipient already has token/nft transfer
                }
                key = `token:${transfer.jettonMasterAddress}`;
                break;
            case "nft":
                if (
                    recipientTransfers.has("token") ||
                    recipientTransfers.has("nft")
                ) {
                    continue; // Skip if recipient already has token/nft transfer
                }
                key = `nft:${transfer.tokenId}`;
                break;
            default:
                continue;
        }

        // Store transfer if key is unique
        if (!uniqueTransfers.has(key)) {
            uniqueTransfers.set(key, transfer);
            recipientTransfers.add(transfer.type);
        }
    }

    const result = Array.from(uniqueTransfers.values());
    // console.log('Deduplication input:', transfers);
    // console.log('Deduplication output:', result);
    return result;
}

/**
 * BatchTransferAction encapsulates the core logic for creating a batch transfer which can include
 * TON coins, fungible tokens (e.g., Jettons), and NFTs. Each transfer item is processed individually,
 * and any errors are recorded per item.
 */
export class BatchTransferAction {
    private walletProvider: WalletProvider;
    constructor(walletProvider: WalletProvider) {
        this.walletProvider = walletProvider;
    }

    /**
     * Build a TON transfer message.
     */
    private buildTonTransfer(item: TransferItem): ReportWithMessage {
        const message = internal({
            to: Address.parse(item.recipientAddress),
            value: toNano(item.amount!),
            bounce: true,
            body: "",
        });
        return {
            report: {
                type: item.type,
                recipientAddress: item.recipientAddress,
                amount: item.amount,
                status: "pending",
            },
            message,
        };
    }

    /**
     * Build a token transfer message.
     */
    private async buildTokenTransfer(
        item: TransferItem
    ): Promise<ReportWithMessage> {
        const tokenAddress = Address.parse(item.jettonMasterAddress!);
        const client = this.walletProvider.getWalletClient();
        const jettonMaster = client.open(JettonMaster.create(tokenAddress));

        const jettonWalletAddress = await jettonMaster.getWalletAddress(
            this.walletProvider.wallet.address
        );

        const forwardPayload = beginCell()
            .storeUint(0, 32) // 0 opcode means we have a comment
            .storeStringTail(item.metadata || "Hello, TON!")
            .endCell();

        const tokenTransferBody = new Builder()
            .storeUint(0x0f8a7ea5, 32)
            .storeUint(0, 64)
            .storeCoins(toNano(item.amount!))
            .storeAddress(Address.parse(item.recipientAddress))
            .storeAddress(Address.parse(item.recipientAddress))
            .storeBit(0)
            .storeCoins(toNano("0.02"))
            .storeBit(1)
            .storeRef(forwardPayload)
            .endCell();

        const message = internal({
            to: jettonWalletAddress,
            value: toNano("0.1"),
            bounce: true,
            body: tokenTransferBody,
        });

        const report: ReportWithMessage = {
            report: {
                type: item.type,
                recipientAddress: item.recipientAddress,
                tokenId: item.tokenId,
                amount: item.amount,
                status: "pending",
            },
            message,
        };
        return report;
    }

    /**
     * Build an NFT transfer message.
     */
    private buildNftTransfer(item: TransferItem): ReportWithMessage {
        const nftTransferBody = beginCell()
            .storeUint(0x5fcc3d14, 32) // OP transfer
            .storeUint(0, 64) // query_id
            .storeAddress(Address.parse(item.recipientAddress)) // new_owner
            .storeAddress(this.walletProvider.wallet.address) // response_destination (sender's address)
            .storeMaybeRef(null) // custom_payload (null in this case)
            .storeCoins(toNano("0.01")) // forward_amount (0.01 TON for notification)
            .storeMaybeRef(null) // forward_payload (null in this case)
            .endCell();

        const message = internal({
            to: Address.parse(item.tokenId!),
            value: toNano("0.05"), // Gas fee for the transfer
            bounce: true,
            body: nftTransferBody,
        });

        return {
            message,
            report: {
                type: item.type,
                recipientAddress: item.recipientAddress,
                tokenId: item.tokenId,
                status: "pending",
            },
        };
    }

    private async processTransferItem(
        item: TransferItem
    ): Promise<ReportWithMessage> {
        const recipientAddress = sanitizeTonAddress(item.recipientAddress);
        if (!recipientAddress) {
            throw new Error(
                `Invalid recipient address: ${item.recipientAddress}`
            );
        }
        item.recipientAddress = recipientAddress;

        if (item.type === "nft" && item.tokenId) {
            const tokenAddress = sanitizeTonAddress(item.tokenId);
            if (!tokenAddress) {
                throw new Error(`Invalid token address: ${item.tokenId}`);
            }
            item.tokenId = tokenAddress;
        }

        switch (item.type) {
            case "ton":
                return this.buildTonTransfer(item);
            case "token":
                elizaLogger.debug(
                    `Processing token transfer to ${recipientAddress} for token ${item.jettonMasterAddress}`
                );
                const result = await this.buildTokenTransfer(item);
                elizaLogger.debug(`Token transfer build complete`);
                return result;
            case "nft":
                return this.buildNftTransfer(item);
            default:
                throw new Error(`Unsupported transfer type: ${item.type}`);
        }
    }

    private async executeTransfer(
        messages: any[],
        transferReports: Report[]
    ): Promise<string | null> {
        try {
            const walletClient = this.walletProvider.getWalletClient();
            const contract = walletClient.open(this.walletProvider.wallet);

            const seqno: number = await contract.getSeqno();
            await sleep(1500);

            const transfer = await contract.createTransfer({
                seqno,
                secretKey: this.walletProvider.keypair.secretKey,
                messages,
                sendMode: SendMode.IGNORE_ERRORS + SendMode.PAY_GAS_SEPARATELY,
            });

            await sleep(1500);
            await contract.send(transfer);

            await waitSeqnoContract(seqno, contract);
            const state = await walletClient.getContractState(
                this.walletProvider.wallet.address
            );
            if (!state.lastTransaction) {
                throw new Error("No last transaction found");
            }
            const { hash: lastHash } = state.lastTransaction;
            const txHash = base64ToHex(lastHash);

            elizaLogger.log(JSON.stringify(transfer));

            // Update reports for successfully processed transfers
            transferReports.forEach((report) => {
                if (report.status === "pending") {
                    report.status = "success";
                }
            });

            return txHash;
        } catch (error: any) {
            // Mark any pending transfers as failures
            transferReports.forEach((report) => {
                if (report.status === "pending") {
                    report.status = "failure";
                    report.error = error.message;
                }
            });
            console.error(JSON.stringify(error));
            elizaLogger.error(
                "Error during batch transfer:"
            );
            return null;
        }
    }

    /**
     * Creates a batch transfer based on an array of transfer items.
     * Each item is processed with a try/catch inside the for loop to ensure that individual errors
     * do not abort the entire batch.
     *
     * @param params - The batch transfer input parameters.
     * @returns An object with a detailed report for each transfer.
     */
    async createBatchTransfer(
        params: BatchTransferContent
    ): Promise<{ hash?: string; reports: Report[] }> {
        // Deduplicate transfers before processing
        const uniqueTransfers = deduplicateTransfers(params);

        const processResults = await Promise.all(
            uniqueTransfers.map(async (item) => {
                try {
                    elizaLogger.debug(
                        `Processing transfer item of type ${item.type}`
                    );
                    const result = await this.processTransferItem(item);
                    return {
                        success: true,
                        message: result.message,
                        report: result.report,
                    };
                } catch (error: any) {
                    elizaLogger.error(
                        `Error processing transfer: ${error.message}`
                    );
                    return {
                        success: false,
                        message: null,
                        report: {
                            type: item.type,
                            recipientAddress: item.recipientAddress,
                            amount: item.amount,
                            tokenId: item.tokenId,
                            status: "failure",
                            error: error.message,
                        },
                    };
                }
            })
        );

        const transferReports: Report[] = [];
        const messages: any[] = [];

        processResults.forEach((result) => {
            if (result.success && result.message) {
                messages.push(result.message);
            }
            transferReports.push(result.report);
        });

        const hash = await this.executeTransfer(messages, transferReports);
        return { hash: hash ?? undefined, reports: transferReports };
    }
}

const buildBatchTransferDetails = async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State
): Promise<BatchTransferContent> => {
    const walletInfo = await nativeWalletProvider.get(runtime, message, state);
    state.walletInfo = walletInfo;

    // Initialize or update state
    let currentState = state;
    if (!currentState) {
        currentState = (await runtime.composeState(message)) as State;
    } else {
        // State is already updated, no need for updateRecentMessageState in v1
    }

    // Compose prompt from state
    const prompt = composePromptFromState({
        state: currentState,
        template: batchTransferTemplate,
    });

    // Generate response using the small model
    const response = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
    });

    // Parse the XML response
    const responseText =
        typeof response === "string" ? response : (response as any).text || "";
    const parsedResponse = parseKeyValueXml(responseText);

    // Convert parsed response to batch transfer format
    const transfers: BatchTransferContent = [];
    let transferIndex = 1;

    if (parsedResponse) {
        while (parsedResponse[`transfer${transferIndex}_type`]) {
            const transfer: SingleTransferContent = {
                type: parsedResponse[`transfer${transferIndex}_type`] as
                    | "ton"
                    | "token"
                    | "nft",
                recipientAddress:
                    parsedResponse[
                        `transfer${transferIndex}_recipientAddress`
                    ] || "",
            };

            if (parsedResponse[`transfer${transferIndex}_amount`]) {
                transfer.amount =
                    parsedResponse[`transfer${transferIndex}_amount`];
            }
            if (
                parsedResponse[`transfer${transferIndex}_jettonMasterAddress`]
            ) {
                transfer.jettonMasterAddress =
                    parsedResponse[
                        `transfer${transferIndex}_jettonMasterAddress`
                    ];
            }
            if (parsedResponse[`transfer${transferIndex}_tokenId`]) {
                transfer.tokenId =
                    parsedResponse[`transfer${transferIndex}_tokenId`];
            }
            if (parsedResponse[`transfer${transferIndex}_metadata`]) {
                transfer.metadata =
                    parsedResponse[`transfer${transferIndex}_metadata`];
            }

            transfers.push(transfer);
            transferIndex++;
        }
    }

    return transfers;
};

export default {
    name: "BATCH_TRANSFER",
    similes: ["BATCH_ASSET_TRANSFER", "MULTI_ASSET_TRANSFER"],
    description:
        "Creates a unified batch transfer for TON coins, tokens (e.g., Jettons), and NFTs. " +
        "Supports flexible input parameters including recipient addresses, amounts, token identifiers, and optional metadata. " +
        "Returns a detailed report summarizing the outcome for each transfer.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State,
        options?: any,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting BATCH_TRANSFER handler...");

        const details: BatchTransferContent = await buildBatchTransferDetails(
            runtime,
            message,
            state || (await runtime.composeState(message))
        );
        console.log(details);
        if (!isBatchTransferContent(details)) {
            console.error("Invalid content for BATCH_TRANSFER action.");
            if (callback) {
                callback({
                    text: "Unable to process transfer request. Invalid content provided.",
                    content: { error: "Invalid transfer content" },
                });
            }
            return false;
        }
        try {
            const walletProvider = await initWalletProvider(runtime);
            const batchTransferAction = new BatchTransferAction(walletProvider);
            const res = await batchTransferAction.createBatchTransfer(details);
            let text = "";

            const reports: Report[] = res.reports;
            if (!res.hash) {
                // for each failed result i want to describe the error in the final message
                const erroredReports = reports.filter(
                    (report: Report) => report.error
                );
                erroredReports.forEach((report: Report) => {
                    text += `Error in transfer to ${report.recipientAddress}: ${report.error}\n\n`;
                });
            }

            if (text === "") {
                text = `Batch transfer processed successfully. \n\n${reports.map((report: Report) => `Transfer to ${report.recipientAddress} ${report.status === "success" ? "succeeded" : "failed"}`).join("\n")} \n\nTotal transfers: ${reports.length} \n\nTransaction hash: ${res.hash}`;
            }

            if (callback) {
                callback({
                    text: text,
                    content: reports,
                });
            }
        } catch (error: any) {
            elizaLogger.error("Error in BATCH_TRANSFER handler:", error);
            if (callback) {
                callback({
                    text: `Error in BATCH_TRANSFER: ${error.message}`,
                    content: { error: error.message },
                });
            }
        }
        return true;
    },
    template: batchTransferTemplate,
    validate: async (_runtime: IAgentRuntime) => true,
    examples: [
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    text: "Transfer 1 TON to 0QBLy_5Fr6f8NSpMt8SmPGiItnUE0JxgTJZ6m6E8aXoLtJHB and 1 SCALE token to 0QBLy_5Fr6f8NSpMt8SmPGiItnUE0JxgTJZ6m6E8aXoLtJHB",
                    action: "BATCH_TRANSFER",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Batch transfer processed successfully",
                },
            },
        ],
    ],
};
