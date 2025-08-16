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
    getBuyPrice,
    getListingData,
} from "../services/nft-marketplace/listingData";
import { buyListing } from "../services/nft-marketplace/listingTransactions";

/**
 * Schema for buy listing input.
 * Only requires:
 * - nftAddress: The NFT contract address.
 */
const buyListingSchema = z
    .object({
        nftAddress: z.string().nonempty("NFT address is required"),
    })
    .refine((data) => data.nftAddress, {
        message: "NFT address is required",
        path: ["nftAddress"],
    });

export interface BuyListingContent extends Content {
    nftAddress: string;
}

function isBuyListingContent(content: Content): content is BuyListingContent {
    return typeof content.nftAddress === "string";
}

const buyListingTemplate = `<system>
Analyze the conversation and extract the following information about the requested NFT purchase:
- NFT address to buy

Format the response as key-value pairs in XML format.
</system>

{{recentMessages}}

<message>
Extract the NFT purchase details from the conversation above.
Respond with the following format:

<nftAddress>nft_address_to_buy</nftAddress>
</message>`;

/**
 * Helper function to build buy listing parameters.
 */
const buildBuyListingData = async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
): Promise<BuyListingContent> => {
    // Initialize or update state
    let currentState = state;
    if (!currentState) {
        currentState = (await runtime.composeState(message)) as State;
    } else {
        currentState = await runtime.composeState(message, ["RECENT_MESSAGES"]);
    }

    const prompt = composePromptFromState({
        state: currentState,
        template: buyListingTemplate,
    });

    const result = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
    });

    const parsedContent = parseKeyValueXml(
        typeof result === "string" ? result : (result as any).value || ""
    );

    const buyContent: BuyListingContent = {
        nftAddress: parsedContent?.nftAddress || "",
        text: "", // Required by Content interface
    };

    // Validate with schema
    const validatedContent = buyListingSchema.parse(buyContent);
    return validatedContent as BuyListingContent;
};

/**
 * BuyListingAction encapsulates the logic to buy an NFT listing.
 */
export class BuyListingAction {
    private walletProvider: WalletProvider;
    constructor(walletProvider: WalletProvider) {
        this.walletProvider = walletProvider;
    }

    /**
     * Buys an NFT listing
     */
    async buy(nftAddress: string): Promise<any> {
        try {
            elizaLogger.log(`Starting purchase of NFT: ${nftAddress}`);

            const receipt = await buyListing(this.walletProvider, nftAddress);

            return receipt;
        } catch (error) {
            elizaLogger.error(`Error buying NFT ${nftAddress}: ${error}`);
            throw new Error(
                `Failed to buy NFT: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}

export default {
    name: "BUY_LISTING",
    similes: ["NFT_BUY", "PURCHASE_NFT", "BUY_NFT"],
    description:
        "Buys a listed NFT by sending the required payment to the listing contract.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State,
        _options?: any,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting BUY_LISTING handler...");
        const params = await buildBuyListingData(
            runtime,
            message,
            state || (await runtime.composeState(message))
        );

        if (!isBuyListingContent(params)) {
            if (callback) {
                callback({
                    text: "Unable to process buy listing request. Invalid content provided.",
                    content: { error: "Invalid buy listing content" },
                });
            }
            return false;
        }

        try {
            const walletProvider = await initWalletProvider(runtime);
            const buyListingAction = new BuyListingAction(walletProvider);

            const result = await buyListingAction.buy(params.nftAddress);

            if (callback) {
                callback({
                    text: JSON.stringify(result, null, 2),
                    content: result,
                });
            }
        } catch (error) {
            elizaLogger.error("Error in BUY_LISTING handler:");
            if (callback) {
                callback({
                    text: `Error in BUY_LISTING: ${error instanceof Error ? error.message : String(error)}`,
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
    template: buyListingTemplate,
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
                    action: "BUY_LISTING",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Buy transaction sent successfully",
                },
            },
        ],
    ],
};

