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
import { Address, JettonMaster } from "@ton/ton";
import { z } from "zod";
import { initWalletProvider, WalletProvider } from "../providers/wallet";
import { JettonMinter } from "../utils/JettonMinter";
import { JettonWallet } from "../utils/JettonWallet";
import { parseTokenMetadataCell } from "../utils/JettonMinterUtils";

/**
 * Schema for jetton interaction input.
 *
 * - jettonMinterAddress: The jetton minter contract address.
 * - jettonWalletAddress: The jetton wallet contract address.
 * - jettonMasterAddress: The jetton master contract address.
 * - ownerAddress: The owner's address.
 * - jettonAction: One of "deployMinter", "mint", "burn", "transfer", "getJettonData", "getWalletData", "changeOwner".
 * - amount: For mint/burn/transfer actions, the amount of jettons as a string.
 * - recipientAddress: For transfer action, the recipient's address. For mint/burn/transfer actions, the address to receive notifications.
 * - metadata: For deployMinter action, the metadata for the jetton.
 * - newOwnerAddress: For changeOwner action, the new owner's address.
 */

const jettonInteractionSchema = z
    .object({
        jettonMinterAddress: z.string().optional().nullable(),
        jettonWalletAddress: z.string().optional().nullable(),
        jettonMasterAddress: z.string().optional().nullable(),
        ownerAddress: z.string().optional().nullable(),
        jettonAction: z.enum([
            "deployMinter",
            "mint",
            "burn",
            "transfer",
            "getJettonData",
            "getWalletData",
            "changeOwner",
        ]),
        amount: z.string().optional().nullable(),
        recipientAddress: z.string().optional().nullable(),
        metadata: z.record(z.string()).optional().nullable(),
        newOwnerAddress: z.string().optional().nullable(),
    })
    .refine(
        (data) => {
            if (data.jettonAction === "deployMinter") {
                return !!data.metadata;
            }
            if (data.jettonAction === "mint") {
                return !!data.jettonMinterAddress && !!data.amount;
            }
            if (data.jettonAction === "burn") {
                return !!data.jettonMinterAddress && !!data.amount;
            }
            if (data.jettonAction === "transfer") {
                return (
                    !!data.jettonWalletAddress &&
                    !!data.amount &&
                    !!data.recipientAddress &&
                    !!data.jettonMasterAddress
                );
            }
            if (data.jettonAction === "getJettonData") {
                return !!data.jettonMinterAddress;
            }
            if (data.jettonAction === "getWalletData") {
                return !!data.jettonWalletAddress;
            }
            if (data.jettonAction === "changeOwner") {
                return !!data.jettonMinterAddress && !!data.newOwnerAddress;
            }
            return false;
        },
        {
            message: "Missing required fields for the specified jetton action",
        }
    );

export interface JettonInteractionContent extends Content {
    jettonMinterAddress?: string;
    jettonWalletAddress?: string;
    ownerAddress?: string;
    jettonAction:
        | "deployMinter"
        | "mint"
        | "burn"
        | "transfer"
        | "getJettonData"
        | "getWalletData"
        | "changeOwner";
    amount?: string;
    recipientAddress?: string;
    metadata?: Record<string, string>;
    newOwnerAddress?: string;
}

function isJettonInteractionContent(
    content: Content
): content is JettonInteractionContent {
    return !!(
        (content.jettonMinterAddress &&
            typeof content.jettonMinterAddress === "string") ||
        (content.jettonAction && typeof content.jettonAction === "string") ||
        (content.jettonWalletAddress &&
            typeof content.jettonWalletAddress === "string") ||
        (content.ownerAddress && typeof content.ownerAddress === "string") ||
        (content.amount && typeof content.amount === "string") ||
        (content.recipientAddress &&
            typeof content.recipientAddress === "string") ||
        (content.metadata && typeof content.metadata === "object") ||
        (content.newOwnerAddress && typeof content.newOwnerAddress === "string")
    );
}

/**
 * Helper function to build jetton interaction parameters.
 * This follows the pattern from the auction interaction action.
 */
const buildJettonInteractionData = async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State
): Promise<JettonInteractionContent> => {
    elizaLogger.debug("Building jetton interaction data from message content");

    // If the content already has the required structure, validate and return it
    if (isJettonInteractionContent(message.content)) {
        elizaLogger.debug(
            "Message content already has jetton interaction structure"
        );
        try {
            const validatedContent = jettonInteractionSchema.parse(
                message.content
            );
            elizaLogger.debug(
                "Content validated successfully"
            );
            return {
                ...validatedContent,
                text: message.content.text || "",
                action: "INTERACT_JETTON",
            } as JettonInteractionContent;
        } catch (error) {
            elizaLogger.error(
                "Error validating existing jetton interaction content"
            );
            throw new Error(`Invalid jetton interaction content: ${error}`);
        }
    }

    // Otherwise, use the LLM to extract the parameters
    elizaLogger.debug("Extracting jetton interaction parameters using LLM");

    // Initialize or update state
    let currentState = state;
    if (!currentState) {
        currentState = (await runtime.composeState(message)) as State;
    } else {
        currentState = await runtime.composeState(message, ["RECENT_MESSAGES"]);
    }

    const prompt = composePromptFromState({
        state: currentState,
        template: jettonInteractionTemplate,
    });

    try {
        const result = await runtime.useModel(ModelType.TEXT_SMALL, {
            prompt,
        });

        const resultText =
            typeof result === "string" ? result : (result as any).value || "";
        const parsedContent = parseKeyValueXml(resultText);

        // Build metadata object from parsed content if deploying minter
        const metadata =
            parsedContent && parsedContent.metadataName
                ? {
                      name: parsedContent.metadataName,
                      symbol: parsedContent.metadataSymbol || "",
                      description: parsedContent.metadataDescription || "",
                      decimals: parsedContent.metadataDecimals || "9",
                      image: parsedContent.metadataImage || "",
                  }
                : undefined;

        const jettonContent: JettonInteractionContent = {
            jettonAction:
                (parsedContent?.jettonAction as any) || "getJettonData",
            jettonMinterAddress:
                parsedContent?.jettonMinterAddress || undefined,
            jettonMasterAddress:
                parsedContent?.jettonMasterAddress || undefined,
            jettonWalletAddress:
                parsedContent?.jettonWalletAddress || undefined,
            amount: parsedContent?.amount || undefined,
            recipientAddress: parsedContent?.recipientAddress || undefined,
            metadata,
            newOwnerAddress: parsedContent?.newOwnerAddress || undefined,
            text: "", // Required by Content interface
        };

        // Validate with schema
        const validatedContent = jettonInteractionSchema.parse(jettonContent);
        elizaLogger.debug(
            "Generated jetton interaction content"
        );
        return validatedContent as JettonInteractionContent;
    } catch (error) {
        elizaLogger.error("Error generating jetton interaction content");
        throw new Error(
            `Failed to extract jetton interaction parameters: ${error}`
        );
    }
};

const jettonInteractionTemplate = `<system>
Analyze the conversation and extract the following information about the requested jetton interaction:
- Jetton action (deployMinter, mint, burn, transfer, getJettonData, getWalletData, changeOwner)
- Contract addresses (minter, master, wallet) based on the action
- Amount (for mint/burn/transfer)
- Recipient address (for transfer, optional for mint/burn)
- Metadata (for deployMinter)
- New owner address (for changeOwner)

Format the response as key-value pairs in XML format.
</system>

{{recentMessages}}

<message>
Extract the jetton interaction details from the conversation above.
Respond with the following format:

<jettonAction>action_type</jettonAction>
<jettonMinterAddress>minter_address_if_applicable</jettonMinterAddress>
<jettonMasterAddress>master_address_if_applicable</jettonMasterAddress>
<jettonWalletAddress>wallet_address_if_applicable</jettonWalletAddress>
<amount>amount_if_applicable</amount>
<recipientAddress>recipient_if_applicable</recipientAddress>
<newOwnerAddress>new_owner_if_applicable</newOwnerAddress>
<metadataName>name_if_deploy</metadataName>
<metadataSymbol>symbol_if_deploy</metadataSymbol>
<metadataDescription>description_if_deploy</metadataDescription>
<metadataDecimals>decimals_if_deploy</metadataDecimals>
<metadataImage>image_url_if_deploy</metadataImage>
</message>`;

export class JettonInteractionAction {
    private walletProvider: WalletProvider;

    constructor(walletProvider: WalletProvider) {
        this.walletProvider = walletProvider;
        elizaLogger.debug(
            "JettonInteractionAction initialized with wallet provider"
        );
    }

    /**
     * Deploy a new Jetton Minter contract
     * @owner The owner of the jetton
     * @param metadata Metadata for the jetton (name, symbol, etc.)
     * @returns Result of the deployment
     */
    async deployMinter(
        owner: string,
        metadata: Record<string, string>
    ): Promise<any> {
        elizaLogger.debug(`Deploying Jetton Minter with owner: ${owner}`);
        try {
            // Deploy the minter contract
            const ownerAddress = Address.parse(owner);
            elizaLogger.debug(
                `Parsed owner address: ${ownerAddress.toString()}`
            );

            elizaLogger.debug("Starting deployment...");
            const jettonMinterAddress = await JettonMinter.deploy(
                this.walletProvider,
                ownerAddress,
                {
                    metadata: metadata,
                    offchainUri: metadata.offchainUri
                        ? metadata.offchainUri
                        : undefined,
                }
            );
            elizaLogger.debug("Deployment completed successfully");

            return {
                success: true,
                minterAddress: jettonMinterAddress.toString(),
            };
        } catch (error) {
            elizaLogger.error("Error deploying Jetton Minter");
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Failed to deploy Jetton Minter: ${errorMessage}`,
                details: error,
            };
        }
    }

    /**
     * Mint new jettons
     * @param jettonMinterAddress Address of the Jetton Minter
     * @param amount Amount of jettons to mint
     * @param recipientAddress Recipient address
     * @returns Result of the mint operation
     */
    async mint(
        jettonMinterAddress: string,
        amount: string,
        recipientAddress: string
    ): Promise<any> {
        elizaLogger.debug(
            `Minting ${amount} jettons from ${jettonMinterAddress} to ${recipientAddress}`
        );
        try {
            const minterAddress = Address.parse(jettonMinterAddress);
            elizaLogger.debug(
                `Parsed minter address: ${minterAddress.toString()}`
            );

            const jettonMinter = JettonMinter.createFromAddress(minterAddress);
            elizaLogger.debug(`Created JettonMinter instance`);

            const recipient = Address.parse(recipientAddress);
            elizaLogger.debug(
                `Parsed recipient address: ${recipient.toString()}`
            );

            const jettonAmount = BigInt(amount);
            elizaLogger.debug(
                `Parsed jetton amount: ${jettonAmount.toString()}`
            );

            // Mint the jettons
            elizaLogger.debug("Starting mint operation...");
            await jettonMinter.sendMint(
                this.walletProvider,
                recipient,
                jettonAmount
            );
            elizaLogger.debug("Mint operation completed");

            return {
                success: true,
                recipientWalletAddress: recipientAddress.toString(),
                amount: amount,
            };
        } catch (error) {
            elizaLogger.error("Error minting Jettons");
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Failed to mint Jettons: ${errorMessage}`,
                details: error,
            };
        }
    }

    /**
     * Burn jettons
     * @param jettonWalletAddress Address of the Jetton Wallet
     * @param amount Amount of jettons to burn
     * @returns Result of the burn operation
     */
    async burn(
        jettonMinterAddress: string,
        amount: string,
        recipientAddress?: string
    ): Promise<any> {
        elizaLogger.debug(
            `Burning ${amount} jettons from minter ${jettonMinterAddress}`
        );
        try {
            const minterAddress = Address.parse(jettonMinterAddress);
            elizaLogger.debug(
                `Parsed minter address: ${minterAddress.toString()}`
            );

            const jettonMinter = JettonMinter.createFromAddress(minterAddress);
            elizaLogger.debug(`Created JettonMinter instance`);

            const jettonAmount = BigInt(amount);
            elizaLogger.debug(
                `Parsed jetton amount: ${jettonAmount.toString()}`
            );

            const recipient = recipientAddress
                ? Address.parse(recipientAddress)
                : null;
            elizaLogger.debug(
                `Recipient address: ${recipient?.toString() || "null"}`
            );

            // Burn the jettons
            elizaLogger.debug("Starting burn operation...");
            await jettonMinter.sendBurn(
                this.walletProvider,
                jettonAmount,
                recipient
            );
            elizaLogger.debug("Burn operation completed");

            return {
                success: true,
                amount: amount,
            };
        } catch (error) {
            elizaLogger.error("Error burning Jettons");
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Failed to burn Jettons: ${errorMessage}`,
                details: error,
            };
        }
    }

    /**
     * Transfer jettons
     * @param jettonWalletAddress Address of the Jetton Wallet
     * @param amount Amount of jettons to transfer
     * @param recipientAddress Recipient address
     * @returns Result of the transfer operation
     */
    async transfer(
        amount: string,
        recipientAddress: string,
        jettonMasterAddress?: string
    ): Promise<any> {
        elizaLogger.debug(
            `Transferring ${amount} jettons from ${jettonMasterAddress} to ${recipientAddress}`
        );
        try {
            const client = this.walletProvider.getWalletClient();
            const jettonMaster = client.open(
                JettonMaster.create(
                    Address.parse(
                        jettonMasterAddress ||
                            "EQBlqsm144Dq6SjbPI4jjZvA1hqTIP3CvHovbIfW_t-SCALE"
                    )
                )
            );

            const userJettonWalletAddress = await jettonMaster.getWalletAddress(
                this.walletProvider.wallet.address
            );

            const jettonWallet: JettonWallet = JettonWallet.createFromAddress(
                userJettonWalletAddress
            );
            elizaLogger.debug(`Created JettonWallet instance`);

            const recipient = Address.parse(recipientAddress);
            elizaLogger.debug(
                `Parsed recipient address: ${recipient.toString()}`
            );

            const jettonAmount = BigInt(amount);
            elizaLogger.debug(
                `Parsed jetton amount: ${jettonAmount.toString()}`
            );

            elizaLogger.debug("Starting transfer operation...");
            await jettonWallet.sendTransfer(
                this.walletProvider,
                userJettonWalletAddress,
                jettonAmount
            );
            elizaLogger.debug("Transfer operation completed");

            return {
                success: true,
                amount: amount,
                recipient: recipientAddress,
            };
        } catch (error) {
            elizaLogger.error("Error transferring Jettons");
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Failed to transfer Jettons: ${errorMessage}`,
                details: error,
            };
        }
    }

    /**
     * Get jetton data
     * @param jettonMinterAddress Address of the Jetton Minter
     * @returns Jetton data
     */
    async getJettonData(jettonMinterAddress: string): Promise<any> {
        elizaLogger.debug(
            `Getting jetton data for minter ${jettonMinterAddress}`
        );
        try {
            const minterAddress = Address.parse(jettonMinterAddress);
            elizaLogger.debug(
                `Parsed minter address: ${minterAddress.toString()}`
            );

            const jettonMinter = JettonMinter.createFromAddress(minterAddress);
            elizaLogger.debug(`Created JettonMinter instance`);

            // Get jetton data
            elizaLogger.debug("Retrieving jetton data...");
            const jettonData = await jettonMinter.getJettonData(
                this.walletProvider
            );
            elizaLogger.debug("Jetton data retrieved");

            // Parse metadata from content cell
            elizaLogger.debug("Parsing token metadata...");
            const metadata = parseTokenMetadataCell(jettonData.content);
            elizaLogger.debug("Token metadata parsed");

            return {
                success: true,
                totalSupply: jettonData.totalSupply.toString(),
                mintable: jettonData.mintable,
                adminAddress: jettonData.adminAddress.toString(),
                metadata: metadata,
            };
        } catch (error) {
            elizaLogger.error("Error getting Jetton data");
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Failed to get Jetton data: ${errorMessage}`,
                details: error,
            };
        }
    }

    /**
     * Get wallet data
     * @param jettonWalletAddress Address of the Jetton Wallet
     * @returns Wallet data
     */
    async getWalletData(jettonWalletAddress: string): Promise<any> {
        elizaLogger.debug(`Getting wallet data for ${jettonWalletAddress}`);
        try {
            const walletAddress = Address.parse(jettonWalletAddress);
            elizaLogger.debug(
                `Parsed wallet address: ${walletAddress.toString()}`
            );

            const jettonWallet = JettonWallet.createFromAddress(walletAddress);
            elizaLogger.debug(`Created JettonWallet instance`);

            // Get wallet data
            elizaLogger.debug("Retrieving wallet data...");
            const walletData = await jettonWallet.getWalletData(
                this.walletProvider
            );
            elizaLogger.debug("Wallet data retrieved");

            return {
                success: true,
                balance: walletData.balance.toString(),
                owner: walletData.owner.toString(),
                jettonMaster: walletData.jettonMaster.toString(),
            };
        } catch (error) {
            elizaLogger.error("Error getting Wallet data");
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Failed to get Wallet data: ${errorMessage}`,
                details: error,
            };
        }
    }

    /**
     * Change owner of the jetton
     * @param jettonMinterAddress Address of the Jetton Minter
     * @param newOwnerAddress New owner address
     * @returns Result of the change owner operation
     */
    async changeOwner(
        jettonMinterAddress: string,
        newOwnerAddress: string
    ): Promise<any> {
        elizaLogger.debug(
            `Changing owner of jetton ${jettonMinterAddress} to ${newOwnerAddress}`
        );
        try {
            const minterAddress = Address.parse(jettonMinterAddress);
            elizaLogger.debug(
                `Parsed minter address: ${minterAddress.toString()}`
            );

            const jettonMinter = JettonMinter.createFromAddress(minterAddress);
            elizaLogger.debug(`Created JettonMinter instance`);

            const newOwner = Address.parse(newOwnerAddress);
            elizaLogger.debug(
                `Parsed new owner address: ${newOwner.toString()}`
            );

            // Change owner
            elizaLogger.debug("Starting change owner operation...");
            await jettonMinter.sendChangeAdmin(this.walletProvider, newOwner);
            elizaLogger.debug("Change owner operation completed");

            return {
                success: true,
                newOwner: newOwnerAddress,
            };
        } catch (error) {
            elizaLogger.error("Error changing Jetton owner");
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Failed to change Jetton owner: ${errorMessage}`,
                details: error,
            };
        }
    }
}

/**
 * Handler for jetton interaction actions
 */
const handler = async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    options?: any,
    callback?: HandlerCallback
) => {
    elizaLogger.log("Starting INTERACT_JETTON handler...");

    try {
        const params: JettonInteractionContent =
            await buildJettonInteractionData(
                runtime,
                message,
                state || (await runtime.composeState(message))
            );
        elizaLogger.debug("Jetton interaction parameters extracted");

        if (!isJettonInteractionContent(params)) {
            const errorMessage =
                "Unable to process jetton interaction request. Invalid content provided.";
            elizaLogger.error(errorMessage);

            if (callback) {
                callback({
                    text: errorMessage,
                    content: { error: "Invalid jetton interaction content" },
                });
            }
            return false;
        }

        elizaLogger.debug("Initializing wallet provider...");
        const walletProvider = await initWalletProvider(runtime);
        elizaLogger.debug("Wallet provider initialized");

        const jettonInteraction = new JettonInteractionAction(walletProvider);
        elizaLogger.debug("JettonInteractionAction instance created");

        let result;
        elizaLogger.debug(`Processing jetton action: ${params.jettonAction}`);

        switch (params.jettonAction) {
            case "deployMinter":
                if (!params.metadata) {
                    throw new Error(
                        "Metadata is required for deployMinter action"
                    );
                }
                elizaLogger.debug("Executing deployMinter action");
                result = await jettonInteraction.deployMinter(
                    params.ownerAddress ||
                        walletProvider.wallet.address.toString(),
                    params.metadata
                );
                break;

            case "mint":
                if (!params.jettonMinterAddress || !params.amount) {
                    throw new Error("Missing required fields for mint action");
                }
                elizaLogger.debug("Executing mint action");
                result = await jettonInteraction.mint(
                    params.jettonMinterAddress,
                    params.amount,
                    params.recipientAddress || ""
                );
                break;

            case "burn":
                if (!params.jettonMinterAddress || !params.amount) {
                    throw new Error("Missing required fields for burn action");
                }
                elizaLogger.debug("Executing burn action");
                result = await jettonInteraction.burn(
                    params.jettonMinterAddress,
                    params.amount,
                    params.recipientAddress
                );
                break;

            case "transfer":
                if (
                    !params.jettonWalletAddress ||
                    !params.amount ||
                    !params.recipientAddress ||
                    !params.jettonMasterAddress
                ) {
                    throw new Error(
                        "Missing required fields for transfer action"
                    );
                }
                elizaLogger.debug("Executing transfer action");
                result = await jettonInteraction.transfer(
                    params.amount,
                    params.recipientAddress,
                    params.jettonMasterAddress as string
                );
                break;

            case "getJettonData":
                if (!params.jettonMinterAddress) {
                    throw new Error(
                        "Jetton minter address is required for getJettonData action"
                    );
                }
                elizaLogger.debug("Executing getJettonData action");
                result = await jettonInteraction.getJettonData(
                    params.jettonMinterAddress
                );
                break;

            case "getWalletData":
                if (!params.jettonWalletAddress) {
                    throw new Error(
                        "Jetton wallet address is required for getWalletData action"
                    );
                }
                elizaLogger.debug("Executing getWalletData action");
                result = await jettonInteraction.getWalletData(
                    params.jettonWalletAddress
                );
                break;

            case "changeOwner":
                if (!params.jettonMinterAddress || !params.newOwnerAddress) {
                    throw new Error(
                        "Missing required fields for changeOwner action"
                    );
                }
                elizaLogger.debug("Executing changeOwner action");
                result = await jettonInteraction.changeOwner(
                    params.jettonMinterAddress,
                    params.newOwnerAddress
                );
                break;

            default:
                throw new Error(
                    `Unknown jetton action: ${params.jettonAction}`
                );
        }

        elizaLogger.debug("Jetton action executed successfully", result);

        const response = {
            text: JSON.stringify(result, null, 2),
            content: result,
        };

        if (callback) {
            elizaLogger.debug("Calling callback with result");
            callback(response);
        }

        return response;
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        elizaLogger.error("Error in jetton interaction handler");

        const errorResponse = {
            text: `Error in jetton interaction: ${errorMessage}`,
            content: { error: errorMessage, details: error },
        };

        if (callback) {
            elizaLogger.debug("Calling callback with error");
            callback(errorResponse);
        }

        return errorResponse;
    }
};

export default {
    name: "INTERACT_JETTON",
    similes: ["JETTON_INTERACT", "JETTON_ACTION"],
    description:
        "Interact with Jetton contracts (deploy, mint, burn, transfer)",
    handler,
    validate: async (_runtime: IAgentRuntime) => {
        return true;
    },
    template: jettonInteractionTemplate,
    examples: [
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    jettonAction: "deployMinter",
                    metadata: {
                        name: "Test Jetton",
                        symbol: "TEST",
                        description: "A test jetton for AI agents",
                        decimals: "9",
                        image: "https://example.com/image.png",
                    },
                    action: "INTERACT_JETTON",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Jetton Minter deployed successfully",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    jettonMinterAddress: "EQJettonMinterAddressExample",
                    jettonAction: "mint",
                    amount: "1000000000", // 1 token with 9 decimals
                    recipientAddress: "EQRecipientAddressExample",
                    action: "INTERACT_JETTON",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Jettons minted successfully",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    jettonWalletAddress: "EQJettonWalletAddressExample",
                    jettonAction: "burn",
                    amount: "500000000", // 0.5 token with 9 decimals
                    action: "INTERACT_JETTON",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Jettons burned successfully",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    jettonWalletAddress: "EQJettonWalletAddressExample",
                    jettonAction: "transfer",
                    amount: "250000000", // 0.25 token with 9 decimals
                    recipientAddress: "EQRecipientAddressExample",
                    action: "INTERACT_JETTON",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Jettons transferred successfully",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    jettonMinterAddress: "EQJettonMinterAddressExample",
                    jettonAction: "getJettonData",
                    action: "INTERACT_JETTON",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Jetton data fetched successfully",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    jettonWalletAddress: "EQJettonWalletAddressExample",
                    jettonAction: "getWalletData",
                    action: "INTERACT_JETTON",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Wallet data fetched successfully",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    jettonMinterAddress: "EQJettonMinterAddressExample",
                    jettonAction: "changeOwner",
                    newOwnerAddress: "EQNewOwnerAddressExample",
                    action: "INTERACT_JETTON",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Owner changed successfully",
                },
            },
        ],
    ],
};
