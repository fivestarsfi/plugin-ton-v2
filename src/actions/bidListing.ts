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
import { z } from "zod";
import { initWalletProvider, WalletProvider } from "../providers/wallet";
import {
    getMinBid,
    getNextValidBidAmount,
    isAuctionEnded,
} from "../services/nft-marketplace/listingData";
import { bidOnAuction } from "../services/nft-marketplace/listingTransactions";
import { toNano } from "@ton/ton";

/**
 * Schema for bid input.
 * Requires:
 * - nftAddress: The NFT contract address.
 * - Optional: bidAmount: The amount to bid (in nanoTON).
 */
const bidAuctionSchema = z
    .object({
        nftAddress: z.string().nonempty("NFT address is required"),
        bidAmount: z.string().optional(),
    })
    .refine((data) => data.nftAddress, {
        message: "NFT address is required",
        path: ["nftAddress"],
    });

export interface BidAuctionContent extends Content {
    nftAddress: string;
    bidAmount?: string;
}

function isBidAuctionContent(content: Content): content is BidAuctionContent {
    return typeof content.nftAddress === "string";
}

const bidAuctionTemplate = `<system>
Analyze the conversation and extract the following information about the requested NFT bid:
- NFT address to bid on
- Bid amount in TON (optional)

Format the response as key-value pairs in XML format.
</system>

{{recentMessages}}

<message>
Extract the NFT bid details from the conversation above.
Respond with the following format:

<nftAddress>nft_address_to_bid_on</nftAddress>
<bidAmount>bid_amount_in_ton_if_specified</bidAmount>
</message>`;

/**
 * Helper function to build bid parameters.
 */
const buildBidAuctionData = async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
): Promise<BidAuctionContent> => {
    // Initialize or update state
    let currentState = state;
    if (!currentState) {
        currentState = (await runtime.composeState(message)) as State;
    } else {
        currentState = await runtime.composeState(message, ["RECENT_MESSAGES"]);
    }

    const prompt = composePromptFromState({
        state: currentState,
        template: bidAuctionTemplate,
    });

    const result = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
    });

    const parsedContent = parseKeyValueXml(
        typeof result === "string" ? result : (result as any).value || ""
    );

    const bidContent: BidAuctionContent = {
        nftAddress: parsedContent?.nftAddress || "",
        bidAmount: parsedContent?.bidAmount || undefined,
        text: "", // Required by Content interface
    };

    // Validate with schema
    const validatedContent = bidAuctionSchema.parse(bidContent);
    return validatedContent as BidAuctionContent;
};

/**
 * BidAuctionAction encapsulates the logic to bid on an NFT auction.
 */
export class BidAuctionAction {
    private walletProvider: WalletProvider;

    constructor(walletProvider: WalletProvider) {
        this.walletProvider = walletProvider;
    }

    /**
     * Validates whether the auction is valid for bidding
     */
    async validateAuction(
        nftAddress: string
    ): Promise<{ valid: boolean; message?: string }> {
        try {
            // Check if auction has ended
            const auctionEnded = await isAuctionEnded(
                this.walletProvider,
                nftAddress
            );
            if (auctionEnded) {
                return {
                    valid: false,
                    message: "This auction has already ended",
                };
            }

            return { valid: true };
        } catch (error) {
            if (
                error instanceof Error &&
                error.message.includes("Not an auction listing")
            ) {
                return {
                    valid: false,
                    message:
                        "This is not an auction. Please use BUY_LISTING instead",
                };
            }
            throw error;
        }
    }

    /**
     * Places a bid on an NFT auction
     */
    async bid(nftAddress: string, bidAmount?: string): Promise<any> {
        try {
            elizaLogger.log(`Starting bid process for NFT: ${nftAddress}`);

            // First validate the auction
            const validationResult = await this.validateAuction(nftAddress);
            if (!validationResult.valid) {
                throw new Error(validationResult.message);
            }

            // Determine the bid amount
            let amount: bigint;
            if (!bidAmount) {
                amount = await getNextValidBidAmount(
                    this.walletProvider,
                    nftAddress
                );
            } else {
                amount = toNano(bidAmount);
            }

            // Place the bid
            const receipt = await bidOnAuction(
                this.walletProvider,
                nftAddress,
                amount
            );

            return receipt;
        } catch (error) {
            elizaLogger.error(`Error bidding on NFT ${nftAddress}: ${error}`);
            throw new Error(
                `Failed to bid on NFT: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}

export default {
    name: "BID_AUCTION",
    similes: ["NFT_BID", "PLACE_BID", "BID_NFT", "AUCTION_BID"],
    description:
        "Places a bid on an NFT auction by sending a transaction with the bid amount. If no bid is mentioned, the next valid bid amount is used.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State,
        _options?: any,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting BID_AUCTION handler...");
        const params = await buildBidAuctionData(
            runtime,
            message,
            state || (await runtime.composeState(message))
        );

        if (!isBidAuctionContent(params)) {
            if (callback) {
                callback({
                    text: "Unable to process bid request. Invalid content provided.",
                    content: { error: "Invalid bid content" },
                });
            }
            return false;
        }

        try {
            const walletProvider = await initWalletProvider(runtime);
            const bidAuctionAction = new BidAuctionAction(walletProvider);

            const result = await bidAuctionAction.bid(
                params.nftAddress,
                params.bidAmount
            );

            if (callback) {
                callback({
                    text: JSON.stringify(result, null, 2),
                    content: result,
                });
            }
        } catch (error) {
            elizaLogger.error("Error in BID_AUCTION handler:");
            if (callback) {
                callback({
                    text: `Error in BID_AUCTION: ${error instanceof Error ? error.message : String(error)}`,
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
    template: bidAuctionTemplate,
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
                    nftAddress: "EQNftAuctionAddressExample",
                    bidAmount: "5000000000",
                    action: "BID_AUCTION",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Bid placed successfully",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    nftAddress: "EQNftAuctionAddressExample",
                    action: "BID_AUCTION",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Bid placed successfully with minimum valid bid",
                },
            },
        ],
    ],
};
