import {
    elizaLogger,
    type IAgentRuntime,
    type Memory,
    type State,
    type HandlerCallback,
    ModelType,
    parseKeyValueXml,
    Content,
    composePromptFromState,
} from "@elizaos/core";
import { WalletProvider, initWalletProvider } from "../providers/wallet";
import { cacheManager } from "src/cache";

interface RuntimeContext {
  cacheManager?: CacheManager;
}

interface CacheManager {
  get?: (key: string) => any;
  set?: (key: string, value: any) => void;
}

export interface CreateWalletContent extends Content {
    encryptionPassword: string;
}

function isCreateWalletContent(
    content: Content
): content is CreateWalletContent {
    return typeof content.encryptionPassword === "string";
}

// Define a template to guide object building (similar to the mint NFT example)
export const passwordTemplate = `Extract the encryption password for wallet creation from the recent messages.

Respond with the value in the following XML format:
<response>
<encryptionPassword>extracted password here</encryptionPassword>
</response>

{{recentMessages}}

Extract the encryption password and respond with the value in the XML format above.`;

/**
 * Builds and validates a password object using the provided runtime, message, and state.
 * This function mimics the object building approach used in the mint NFT action.
 */
export async function buildCreateWalletDetails(
    runtime: IAgentRuntime,
    message: Memory,
    state?: State
): Promise<CreateWalletContent> {
    // Compose the current state (or create one based on the message)
    const currentState = state || (await runtime.composeState(message));

    // Compose prompt from state
    const prompt = composePromptFromState({
        state: currentState,
        template: passwordTemplate,
    });

    // Generate response using the small model
    const response = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
    });

    // Parse the XML response
    const parsedResponse = parseKeyValueXml(response);

    const createWalletContent: CreateWalletContent = {
        encryptionPassword: parsedResponse?.encryptionPassword || "",
        text: "", // Required by Content interface
    };

    return createWalletContent;
}

export class CreateWalletAction {
    async createWallet(
        runtime: IAgentRuntime,
        params: { rpcUrl: string; encryptionPassword: string }
    ): Promise<{ walletAddress: string; mnemonic: string[] }> { 

    const { walletProvider, mnemonic } = await WalletProvider.generateNew(
            params.rpcUrl,
            params.encryptionPassword,
            cacheManager
        );
        const walletAddress = walletProvider.getAddress();
        return { walletAddress, mnemonic };
    }
}

export default {
    name: "CREATE_TON_WALLET",
    similes: ["NEW_TON_WALLET", "MAKE_NEW_TON_WALLET"],
    description:
        "Creates a new TON wallet on demand. Returns the public address and mnemonic backup (store it securely). The wallet keypair is also encrypted to a file using the provided password.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State,
        _options?: Record<string, unknown>,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting CREATE_TON_WALLET action...");

        // Build password details using the object building approach like in the mint NFT action.
        const createWalletContent = await buildCreateWalletDetails(
            runtime,
            message,
            state
        );

        elizaLogger.debug("createWalletContent");
        if (!isCreateWalletContent(createWalletContent)) {
            if (callback) {
                callback({
                    text: "Unable to process create wallet request. No password provided.",
                    content: {
                        error: "Invalid create wallet. No password provided.",
                    },
                });
            }
            return false;
        }
        try {
            // Generate a new wallet using the provided password.

            const rpcUrl =
                runtime.getSetting("TON_RPC_URL") ||
                "https://toncenter.com/api/v2/jsonRPC";
            const action = new CreateWalletAction();

            const { walletAddress, mnemonic } = await action.createWallet(
                runtime,
                {
                    rpcUrl,
                    encryptionPassword: createWalletContent.encryptionPassword,
                }
            );
            const result = {
                status: "success",
                walletAddress,
                mnemonic, // IMPORTANT: The mnemonic backup must be stored securely!
                message:
                    "New TON wallet created. Store the mnemonic securely for recovery.",
            };

            if (callback) {
                callback({
                    text: `
New TON wallet created!
Your password was used to encrypt the wallet keypair, but never stored.
Wallet Address: ${walletAddress}
I've used both your password and the mnemonic to create the wallet.
Please securely store your mnemonic:
${mnemonic.join(" ")}`,
                    content: result,
                });
            }

            return true;
        } catch (error: any) {
            elizaLogger.error("Error creating wallet:", error);
            if (callback) {
                callback({
                    text: `Error creating wallet: ${error.message}`,
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
                    text: "Please create a new TON wallet for me.",
                    action: "CREATE_TON_WALLET",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "New TON wallet created!/n Your password was used to encrypt the wallet keypair, but never stored./nWallet Address: EQAXxxxxxxxxxxxxxxxxxxxxxx./n I've used both your password and the mnemonic to create the wallet./nPlease securely store your mnemonic",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    text: "Please make me a new TON wallet.",
                    action: "CREATE_TON_WALLET",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "New TON wallet created!/n Your password was used to encrypt the wallet keypair, but never stored./nWallet Address: EQAXxxxxxxxxxxxxxxxxxxxxxx./n I've used both your password and the mnemonic to create the wallet./nPlease securely store your mnemonic",
                },
            },
        ],
    ],
};
