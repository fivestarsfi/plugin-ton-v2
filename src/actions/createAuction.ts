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
import { Address, internal, SendMode, toNano } from "@ton/ton";
import { z } from "zod";
import { initWalletProvider, WalletProvider } from "../providers/wallet";
import { waitSeqnoContract } from "../utils/util";
import {
    buildNftAuctionV3R3DeploymentBody, // This function would need to be implemented in the utils
    destinationAddress,
    marketplaceAddress,
    marketplaceFeeAddress,
} from "../services/nft-marketplace/listingFactory";

// Configuration constants
const CONFIG = {
    royaltyPercent: 5,
    marketplaceFeePercent: 5,
};

/**
 * Schema for create auction input.
 * Requires:
 * - nftAddress: The NFT contract address.
 * - minimumBid: The minimum bid for the auction in TON.
 * - maximumBid: The maximum bid (or buyout price) for the auction in TON.
 * - expiryTime: The expiry time for the auction in hours.
 */
const createAuctionSchema = z
    .object({
        nftAddress: z.string().nonempty("NFT address is required"),
        minimumBid: z.string().nonempty("Minimum bid is required"),
        maximumBid: z
            .string()
            .nonempty("Maximum bid (buyout price) is required"),
        expiryTime: z.string().nonempty("Expiry time is required"),
    })
    .refine(
        (data) =>
            data.nftAddress &&
            data.minimumBid &&
            data.maximumBid &&
            data.expiryTime,
        {
            message:
                "NFT address, minimum bid, maximum bid, and expiry time are required",
            path: ["nftAddress", "minimumBid", "maximumBid", "expiryTime"],
        }
    );

export interface CreateAuctionContent extends Content {
    nftAddress: string;
    minimumBid: string;
    maximumBid: string;
    expiryTime: string;
}

function isCreateAuctionContent(
    content: Content
): content is CreateAuctionContent {
    return (
        typeof content.nftAddress === "string" &&
        typeof content.minimumBid === "string" &&
        typeof content.maximumBid === "string" &&
        typeof content.expiryTime === "string"
    );
}

const createAuctionTemplate = `<system>
Analyze the conversation and extract the following information about the requested NFT auction:
- NFT address to auction
- Minimum bid amount in TON
- Maximum bid (buyout price) in TON
- Expiry time in hours

Format the response as key-value pairs in XML format.
</system>

{{recentMessages}}

<message>
Extract the NFT auction details from the conversation above.
Respond with the following format:

<nftAddress>nft_address</nftAddress>
<minimumBid>minimum_bid_in_ton</minimumBid>
<maximumBid>maximum_bid_in_ton</maximumBid>
<expiryTime>expiry_time_in_hours</expiryTime>
</message>`;

/**
 * Helper function to build create auction parameters.
 */
const buildCreateAuctionData = async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
): Promise<CreateAuctionContent> => {
    // Initialize or update state
    let currentState = state;
    if (!currentState) {
        currentState = (await runtime.composeState(message)) as State;
    } else {
        currentState = await runtime.composeState(message, ["RECENT_MESSAGES"]);
    }

    const prompt = composePromptFromState({
        state: currentState,
        template: createAuctionTemplate,
    });

    const result = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
    });

    const parsedContent = parseKeyValueXml(
        typeof result === "string" ? result : (result as any).value || ""
    );

    const auctionContent: CreateAuctionContent = {
        nftAddress: parsedContent?.nftAddress || "",
        minimumBid: parsedContent?.minimumBid || "",
        maximumBid: parsedContent?.maximumBid || "",
        expiryTime: parsedContent?.expiryTime || "",
        text: "", // Required by Content interface
    };

    // Validate with schema
    const validatedContent = createAuctionSchema.parse(auctionContent);
    return validatedContent as CreateAuctionContent;
};

/**
 * CreateAuctionAction encapsulates the logic to create an auction for an NFT.
 */
export class CreateAuctionAction {
    private walletProvider: WalletProvider;
    constructor(walletProvider: WalletProvider) {
        this.walletProvider = walletProvider;
    }

    /**
     * Creates an auction for an NFT using default marketplace configuration
     */
    async createAuction(params: CreateAuctionContent): Promise<any> {
        const client = this.walletProvider.getWalletClient();
        const contract = client.open(this.walletProvider.wallet);

        elizaLogger.info("Creating auction with params: ");

        const minimumBid = toNano(params.minimumBid);
        const maximumBid = toNano(params.maximumBid);
        const expiryTime =
            Math.floor(Date.now() / 1000) + parseInt(params.expiryTime) * 3600; // Convert hours to seconds and add to current timestamp
        const royalty = CONFIG.royaltyPercent;
        const fee = CONFIG.marketplaceFeePercent;

        const auctionData = {
            nftAddress: Address.parse(params.nftAddress),
            nftOwnerAddress: this.walletProvider.wallet.address,
            deployerAddress: destinationAddress,
            marketplaceAddress: marketplaceAddress,
            marketplaceFeeAddress: marketplaceFeeAddress,
            marketplaceFeePercent: (maximumBid / BigInt(100)) * BigInt(fee),
            royaltyAddress: this.walletProvider.wallet.address, // Using wallet address as royalty recipient
            royaltyPercent: (maximumBid / BigInt(100)) * BigInt(royalty),
            minimumBid: minimumBid,
            maximumBid: maximumBid,
            expiryTime: expiryTime,
        };

        elizaLogger.info("Minbid: ");

        const auctionBody =
            await buildNftAuctionV3R3DeploymentBody(auctionData);

        const seqno = await contract.getSeqno();
        const auctionMessage = internal({
            to: params.nftAddress,
            value: toNano("0.5"), // Increased value for auction operations
            bounce: true,
            body: auctionBody,
        });

        const transfer = await contract.sendTransfer({
            seqno,
            secretKey: this.walletProvider.keypair.secretKey,
            messages: [auctionMessage],
            sendMode: SendMode.IGNORE_ERRORS + SendMode.PAY_GAS_SEPARATELY,
        });

        await waitSeqnoContract(seqno, contract);

        return {
            nftAddress: params.nftAddress,
            minimumBid: params.minimumBid,
            maximumBid: params.maximumBid,
            expiryTime: params.expiryTime,
            message: "NFT auction created successfully",
            marketplaceFee: `${fee}%`,
            royaltyFee: `${royalty}%`,
            expiryTimestamp: new Date(Number(expiryTime) * 1000).toISOString(),
        };
    }
}

export default {
    name: "CREATE_AUCTION",
    similes: ["NFT_AUCTION", "AUCTION_NFT", "START_AUCTION"],
    description:
        "Creates an auction for an NFT by sending the appropriate message to the NFT contract. Requires NFT address, minimum bid, maximum bid (buyout price), and auction expiry time in hours.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State,
        _options?: any,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting CREATE_AUCTION handler...");
        const params = await buildCreateAuctionData(
            runtime,
            message,
            state || (await runtime.composeState(message))
        );

        if (!isCreateAuctionContent(params)) {
            if (callback) {
                callback({
                    text: "Unable to process create auction request. Invalid content provided.",
                    content: { error: "Invalid create auction content" },
                });
            }
            return false;
        }

        try {
            const walletProvider = await initWalletProvider(runtime);
            const createAuctionAction = new CreateAuctionAction(walletProvider);

            const result = await createAuctionAction.createAuction(params);

            if (callback) {
                callback({
                    text: JSON.stringify(result, null, 2),
                    content: result,
                });
            }
        } catch (error) {
            elizaLogger.error("Error in CREATE_AUCTION handler:");
            if (callback) {
                callback({
                    text: `Error in CREATE_AUCTION: ${error instanceof Error ? error.message : String(error)}`,
                    content: {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    },
                });
            }
        }
        return true;
    },
    template: createAuctionTemplate,
    // eslint-disable-next-line
    validate: async (_runtime: IAgentRuntime) => {
        return true;
    },
    examples: [
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    nftAddress: "EQNftAddressExample",
                    minimumBid: "5",
                    maximumBid: "20",
                    expiryTime: "48",
                    action: "CREATE_AUCTION",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "NFT auction created successfully",
                },
            },
        ],
    ],
};
