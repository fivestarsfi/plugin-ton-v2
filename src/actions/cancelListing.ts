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
import { Address, internal, SendMode, toNano, Cell, beginCell } from "@ton/ton";
import { z } from "zod";
import { initWalletProvider, WalletProvider } from "../providers/wallet";
import { waitSeqnoContract } from "../utils/util";
import { getListingData } from "../services/nft-marketplace/listingData";
import { cancelListing } from "../services/nft-marketplace/listingTransactions";

/**
 * Schema for cancel listing input.
 * Only requires:
 * - nftAddress: The NFT contract address.
 */
const cancelListingSchema = z
    .object({
        nftAddress: z.string().nonempty("NFT address is required"),
    })
    .refine((data) => data.nftAddress, {
        message: "NFT address is required",
        path: ["nftAddress"],
    });

export interface CancelListingContent extends Content {
    nftAddress: string;
}

function isCancelListingContent(
    content: Content
): content is CancelListingContent {
    return typeof content.nftAddress === "string";
}

const cancelListingTemplate = `<system>
Analyze the conversation and extract the following information about the requested NFT listing cancellation:
- NFT address to cancel the listing for

Format the response as key-value pairs in XML format.
</system>

{{recentMessages}}

<message>
Extract the NFT listing cancellation details from the conversation above.
Respond with the following format:

<nftAddress>nft_address_to_cancel</nftAddress>
</message>`;

/**
 * Helper function to build cancel listing parameters.
 */
const buildCancelListingData = async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
): Promise<CancelListingContent> => {
    // Initialize or update state
    let currentState = state;
    if (!currentState) {
        currentState = (await runtime.composeState(message)) as State;
    } else {
        currentState = await runtime.composeState(message, ["RECENT_MESSAGES"]);
    }

    const prompt = composePromptFromState({
        state: currentState,
        template: cancelListingTemplate,
    });

    const result = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
    });

    const parsedContent = parseKeyValueXml(
        typeof result === "string" ? result : (result as any).value || ""
    );

    const cancelContent: CancelListingContent = {
        nftAddress: parsedContent?.nftAddress || "",
        text: "", // Required by Content interface
    };

    // Validate with schema
    const validatedContent = cancelListingSchema.parse(cancelContent);
    return validatedContent as CancelListingContent;
};

/**
 * CancelListingAction encapsulates the logic to cancel an NFT listing.
 */
export class CancelListingAction {
    private walletProvider: WalletProvider;
    constructor(walletProvider: WalletProvider) {
        this.walletProvider = walletProvider;
    }

    /**
     * Cancels an NFT listing
     */
    async cancel(nftAddress: string): Promise<any> {
        try {
            elizaLogger.log(
                `Starting cancellation of NFT listing: ${nftAddress}`
            );

            const receipt = await cancelListing(
                this.walletProvider,
                nftAddress
            );
            return receipt;
        } catch (error) {
            elizaLogger.error(
                `Error cancelling NFT listing ${nftAddress}: ${error}`
            );
            throw new Error(
                `Failed to cancel NFT listing: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}

export default {
    name: "CANCEL_LISTING",
    similes: ["NFT_CANCEL", "CANCEL_NFT", "CANCEL_SALE"],
    description:
        "Cancels a listed NFT by sending a cancel operation to the listing contract.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State,
        _options?: any,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting CANCEL_LISTING handler...");
        const params = await buildCancelListingData(
            runtime,
            message,
            state || (await runtime.composeState(message))
        );

        if (!isCancelListingContent(params)) {
            if (callback) {
                callback({
                    text: "Unable to process cancel listing request. Invalid content provided.",
                    content: { error: "Invalid cancel listing content" },
                });
            }
            return false;
        }

        try {
            const walletProvider = await initWalletProvider(runtime);
            const cancelListingAction = new CancelListingAction(walletProvider);

            const result = await cancelListingAction.cancel(params.nftAddress);

            if (callback) {
                callback({
                    text: JSON.stringify(result, null, 2),
                    content: result,
                });
            }
        } catch (error) {
            elizaLogger.error("Error in CANCEL_LISTING handler:");
            if (callback) {
                callback({
                    text: `Error in CANCEL_LISTING: ${error instanceof Error ? error.message : String(error)}`,
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
    template: cancelListingTemplate,
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
                    action: "CANCEL_LISTING",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Cancel listing transaction sent successfully",
                },
            },
        ],
    ],
};
