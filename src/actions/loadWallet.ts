import {
    elizaLogger,
    type IAgentRuntime,
    type Memory,
    type State,
    type HandlerCallback,
    Content,
    composePromptFromState,
    parseKeyValueXml,
    ModelType,
} from "@elizaos/core";
import { WalletProvider } from "../providers/wallet";

export interface RecoverWalletContent extends Content {
    password: string;
    walletAddress: string;
}

function isRecoverWalletContent(
    content: Content
): content is RecoverWalletContent {
    return (
        typeof content.password === "string" &&
        typeof content.walletAddress === "string"
    );
}

// Define a template to guide object building (similar to the mint NFT example)
const recoverWalletTemplate = `Extract the password and wallet address for wallet recovery from the recent messages.

Respond with the values in the following XML format:
<response>
<password>extracted password here</password>
<walletAddress>extracted wallet address here</walletAddress>
</response>

{{recentMessages}}

Extract the password and wallet address for wallet recovery and respond with values in the XML format above.`;

/**
 * Builds and validates a password object using the provided runtime, message, and state.
 * This function mimics the object building approach used in the mint NFT action.
 */
export async function buildRecoverWalletDetails(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
): Promise<RecoverWalletContent> {
    // Compose the current state (or create one based on the message)
    const currentState = state || (await runtime.composeState(message));

    // Compose a prompt from state and template
    const prompt = composePromptFromState({
        state: currentState,
        template: recoverWalletTemplate,
    });

    // Generate response using the small model
    const response = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
    });

    // Parse the XML response
    const parsedResponse = parseKeyValueXml(response);

    const recoverWalletContent: RecoverWalletContent = {
        password: parsedResponse?.password || "",
        walletAddress: parsedResponse?.walletAddress || "",
        text: "", // Required by Content interface
    };

    return recoverWalletContent;
}

export default {
    name: "RECOVER_TON_WALLET",
    similes: ["IMPORT_TON_WALLET", "RECOVER_WALLET"],
    description:
        "Loads an existing TON wallet from an encrypted backup file using the provided password.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State,
        _options?: Record<string, unknown>,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting RECOVER_TON_WALLET action...");

        const recoverWalletContent = await buildRecoverWalletDetails(
            runtime,
            message,
            state
        );

        if (!isRecoverWalletContent(recoverWalletContent)) {
            if (callback) {
                callback({
                    text: "Unable to process load wallet request. No password or address provided.",
                    content: {
                        error: "Invalid load wallet. No password or address provided.",
                    },
                });
            }
            return false;
        }

        try {
            elizaLogger.debug("recoverWalletContent");
            // Get the export password from settings.
            const password = recoverWalletContent.password;
            if (!password) {
                if (callback) {
                    callback({
                        text: "Unable to process load wallet request. No password provided.",
                        content: {
                            error: "Invalid load wallet. No password provided.",
                        },
                    });
                    return false;
                }
            }
            // Get the backup file path. You can pass the filePath via message content or via settings.
            const walletAddress = recoverWalletContent.walletAddress;
            if (!walletAddress) {
                if (callback) {
                    callback({
                        text: "Unable to process load wallet request. No wallet address provided.",
                        content: {
                            error: "Invalid load wallet. No wallet address provided.",
                        },
                    });
                    return false;
                }
            }

            const walletProvider = await WalletProvider.importWalletFromFile(
                runtime,
                walletAddress,
                password
            );

            const result = {
                status: "success",
                walletAddress,
                message: `
Wallet recovered successfully.
Your Decrypted wallet is: ${JSON.stringify(walletProvider.keypair)}.
Please store it securely.`,
            };

            if (callback) {
                callback({
                    text: `Wallet recovered successfully.\n\n Your Decrypted wallet is: ${JSON.stringify(walletProvider.keypair)}.\n\n Please store it securely.`,
                    content: result,
                });
            }

            return true;
        } catch (error: any) {
            elizaLogger.error("Error recovering wallet:", error);
            if (callback) {
                callback({
                    text: `Error recovering wallet: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },
    validate: async (_runtime: IAgentRuntime) => true,
    examples: [
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    text: "Please recover my TON wallet. My decryption password is my_password and my wallet address is EQAXxxxxxxxxxxxxxxxxxxxxxx.",
                    action: "RECOVER_TON_WALLET",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Wallet recovered successfully. Your Decrypted wallet is: ${JSON.stringify(walletProvider.keypair)}. Please store it securely.",
                },
            },
        ],
    ],
};
