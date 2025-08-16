import {
    elizaLogger,
    type IAgentRuntime,
    type Memory,
    type State,
    type HandlerCallback,
    type Content,
    composePromptFromState,
    parseKeyValueXml,
    ModelType,
} from "@elizaos/core";
import { Address, beginCell, Cell, internal, toNano } from "@ton/ton";
import { initWalletProvider, type WalletProvider } from "../providers/wallet";
import { base64ToHex, waitSeqnoContract } from "../utils/util";

export interface TransferNFTContent extends Content {
    nftAddress: string;
    newOwner: string;
}

function isTransferNFTContent(content: Content): content is TransferNFTContent {
    console.log("Content for transfer", content);
    return (
        typeof content.nftAddress === "string" &&
        typeof content.newOwner === "string"
    );
}

/**
 * Template string to guide the AI agent (if needed).
 */
const transferNFTTemplate = `Extract the NFT transfer information from the conversation.

{{recentMessages}}

Extract the NFT address and new owner address.

Respond with the extracted values in this XML format:
<values>
<nftAddress>NFT_ADDRESS_HERE</nftAddress>
<newOwner>NEW_OWNER_ADDRESS_HERE</newOwner>
</values>`;

/**
 * The TransferNFTAction class encapsulates the logic for transferring NFT ownership.
 */
class TransferNFTAction {
    private walletProvider: WalletProvider;

    constructor(walletProvider: WalletProvider) {
        this.walletProvider = walletProvider;
    }

    private createTransferBody(params: {
        newOwner: Address;
        responseTo?: Address;
        forwardAmount?: bigint;
    }): Cell {
        const msgBody = beginCell();
        msgBody.storeUint(0x5fcc3d14, 32); // op-code for transfer
        msgBody.storeUint(0, 64); // query-id
        msgBody.storeAddress(params.newOwner);
        msgBody.storeAddress(params.responseTo || null);
        msgBody.storeBit(false); // no custom payload
        msgBody.storeCoins(params.forwardAmount || 0);
        msgBody.storeBit(0); // no forward_payload

        return msgBody.endCell();
    }
    /**
     * Crafts and sends a transfer message to the NFT smart contract.
     * Note: This implementation simulates the deployment of the transfer transaction.
     */
    async transfer(params: TransferNFTContent): Promise<string> {
        // Use a TON client (using testnet endpoint; adjust as needed).
        elizaLogger.log(
            `[Plugin-TON] Transferring: ${params.nftAddress} to (${params.newOwner})`
        );

        const walletClient = this.walletProvider.getWalletClient();
        const contract = walletClient.open(this.walletProvider.wallet);

        try {
            // Parse the NFT smart contract address.
            const nftAddressParsed = Address.parse(params.nftAddress);

            // Parse the new owner and authorized wallet addresses.
            const newOwnerAddress = Address.parse(params.newOwner);

            // Create a transfer
            const seqno: number = await contract.getSeqno();

            const transfer = contract.createTransfer({
                seqno,
                secretKey: this.walletProvider.keypair.secretKey,
                messages: [
                    internal({
                        value: "0.05",
                        to: nftAddressParsed,
                        body: this.createTransferBody({
                            newOwner: newOwnerAddress,
                            responseTo: contract.address,
                            forwardAmount: toNano("0.02"),
                        }),
                    }),
                ],
            });

            await contract.send(transfer);
            elizaLogger.log("Transaction sent, waiting for confirmation...");

            // Wait for transaction confirmation using waitSeqnoContract
            await waitSeqnoContract(seqno, contract);

            const state = await walletClient.getContractState(
                this.walletProvider.wallet.address
            );

            const lastTransaction = state.lastTransaction;
            if (!lastTransaction) {
                throw new Error("No last transaction found");
            }
            const { lt: _, hash: lastHash } = lastTransaction;
            return base64ToHex(lastHash);
        } catch (error) {
            throw new Error(
                `Transfer failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}

const buildTransferNFTContent = async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State
): Promise<TransferNFTContent> => {
    // Initialize or update state
    let currentState = state;
    if (!currentState) {
        currentState = (await runtime.composeState(message)) as State;
    }

    // Compose transfer context
    const transferContext = composePromptFromState({
        state: currentState,
        template: transferNFTTemplate,
    });

    // Generate transfer content
    const response = await runtime.useModel(ModelType.SMALL, {
        prompt: transferContext,
    });

    const parsedResponse = parseKeyValueXml(response);

    const transferContent: TransferNFTContent = {
        nftAddress: parsedResponse?.nftAddress || "",
        newOwner: parsedResponse?.newOwner || "",
    };

    return transferContent;
};

/**
 * The action to initiate an NFT ownership transfer.
 * It verifies that the calling (authorized) wallet is the current owner of the NFT.
 */
export default {
    name: "TRANSFER_NFT",
    similes: ["NFT_TRANSFER", "TRANSFER_OWNERSHIP"],
    description:
        "Transfers ownership of an existing NFT item. Only an authorized agent (matching the NFT's current owner) can invoke this action. The authorized wallet is verified using the wallet provider (via runtime settings).",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options?: Record<string, unknown>,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting TRANSFER_NFT handler...");

        const transferDetails = await buildTransferNFTContent(
            runtime,
            message,
            state
        );

        // Validate transfer content
        if (!isTransferNFTContent(transferDetails)) {
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
            // Fetch the current NFT owner via get_nft_data.
            const result = await walletProvider
                .getWalletClient()
                .runMethod(
                    Address.parse(transferDetails.nftAddress),
                    "get_nft_data"
                );

            // Custom serializer for BigInt values
            const safeStringify = (obj: any) => {
                return JSON.stringify(obj, (_, value) =>
                    typeof value === "bigint" ? value.toString() : value
                );
            };

            elizaLogger.log(`NFT data result: ${safeStringify(result)}`);

            // Read the elements from the stack in order
            const init = result.stack.readNumber(); // Read the init flag (1st element)
            const index = result.stack.readNumber(); // Read the index (2nd element)
            const collectionAddress = result.stack.readAddress(); // Read collection address (3rd element)
            const ownerAddress = result.stack.readAddress(); // Read owner address (4th element)

            // Now we have the owner address
            const currentOwnerAddress = ownerAddress?.toString();
            elizaLogger.log(`Current NFT owner: ${currentOwnerAddress}`);
            if (!currentOwnerAddress) {
                throw new Error(
                    "Could not retrieve current NFT owner address."
                );
            }
            if (
                currentOwnerAddress !== walletProvider.wallet.address.toString()
            ) {
                throw new Error("You are not the owner of this NFT.");
            }
            elizaLogger.log(`Current NFT owner: ${currentOwnerAddress}`);

            // Proceed with the transfer.
            const transferAction = new TransferNFTAction(walletProvider);
            await transferAction.transfer(transferDetails);

            const response = {
                status: "success",
                nftAddress: transferDetails.nftAddress,
                newOwner: transferDetails.newOwner,
                message: "NFT ownership transfer initiated successfully",
            };

            if (callback) {
                callback({
                    text: `Successfully transferred NFT from ${currentOwnerAddress} to ${transferDetails.newOwner}`,
                    content: response,
                });
            }
            return true;
        } catch (error: any) {
            elizaLogger.error("Error transferring NFT:", error);
            if (callback) {
                callback({
                    text: `Error transferring NFT: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },
    validate: async (_runtime: IAgentRuntime) => true,
    template: transferNFTTemplate,
    examples: [
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                text: "Transfer NFT with address {{nftAddress}} from {{user1}} to {{user2}}",
                content: {
                    nftAddress: "NFT_123456789",
                    newOwner: "EQNewOwnerAddressExample",
                    action: "TRANSFER_NFT",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "NFT ownership transfer initiated successfully",
                },
            },
        ],
    ],
};
 
