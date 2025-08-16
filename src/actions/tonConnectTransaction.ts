import {
    elizaLogger,
    composePromptFromState,
    parseKeyValueXml,
    type Content,
    type HandlerCallback,
    ModelType,
    type IAgentRuntime,
    type Memory,
    type State,
} from "@elizaos/core";
import {
    initTonConnectProvider,
    TonConnectProvider,
} from "../providers/tonConnect";
import {
    CHAIN,
    SendTransactionRequest,
    UserRejectsError,
} from "@tonconnect/sdk";

export interface TonConnectSendTransactionContent extends Content {
    validUntil?: number;
    network?: CHAIN;
    from?: string;
    messages: {
        address: string;
        amount: string;
        stateInit?: string;
        payload?: string;
    }[];
}

function isTonConnectSendTransactionContent(
    content: Content
): content is TonConnectSendTransactionContent {
    console.log("Content for TonConnect transaction", content);
    if (!content.messages || !Array.isArray(content.messages)) {
        return false;
    }

    return content.messages.every(
        (message) =>
            typeof message.address === "string" &&
            typeof message.amount === "string"
    );
}

const tonConnectSendTransactionTemplate = `Extract the transaction information from the conversation.

{{recentMessages}}

Extract the following information about the requested transaction:
- List of messages with recipient addresses and amounts
- Convert all amounts to nanotons (1 TON = 1,000,000,000 nanotons)
- Optional stateInit (base64 encoded contract code)
- Optional payload (base64 encoded message body)
- Optional network specification (MAINNET or TESTNET)
- Optional from address
- Optional validUntil timestamp (in unix seconds)

Respond with the extracted values in this XML format:
<values>
<validUntil>UNIX_TIMESTAMP_OR_EMPTY</validUntil>
<network>MAINNET_OR_TESTNET_OR_EMPTY</network>
<from>FROM_ADDRESS_OR_EMPTY</from>
<messages>
<message>
<address>RECIPIENT_ADDRESS</address>
<amount>AMOUNT_IN_NANOTONS</amount>
<stateInit>BASE64_ENCODED_OR_EMPTY</stateInit>
<payload>BASE64_ENCODED_OR_EMPTY</payload>
</message>
</messages>
</values>`;

export class TonConnectSendTransactionAction {
    async sendTransaction(
        params: TonConnectSendTransactionContent,
        provider: TonConnectProvider
    ): Promise<string> {
        console.log(`Sending transaction via TonConnect`);

        if (!provider.isConnected()) {
            throw new Error("Please connect wallet to send the transaction!");
        }

        const transaction: SendTransactionRequest = {
            validUntil: params.validUntil || Math.floor(Date.now() / 1000) + 60,
            network: params.network,
            from: params.from,
            messages: params.messages,
        };

        try {
            const result = await provider.sendTransaction(transaction);
            console.log("Transaction sent successfully");
            return result.boc;
        } catch (error) {
            if (error instanceof UserRejectsError) {
                throw new Error(
                    "You rejected the transaction. Please confirm it to send to the blockchain"
                );
            }
            throw new Error(
                `Unknown error happened: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}

const buildTonConnectSendTransactionDetails = async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State
): Promise<TonConnectSendTransactionContent> => {
    let currentState = state;
    if (!currentState) {
        currentState = (await runtime.composeState(message)) as State;
    }

    const transactionContext = tonConnectSendTransactionTemplate.replace(
        "{{currentState}}",
        JSON.stringify(currentState)
    );

    const response = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt: transactionContext,
        temperature: 0.7,
    });

    const parsedResponse = parseKeyValueXml(response as string);

    // Parse messages array from XML response
    const messages = [];
    if (parsedResponse?.messages) {
        // Handle single message or array of messages
        const messageList = Array.isArray(parsedResponse?.messages?.message)
            ? parsedResponse.messages.message
            : [parsedResponse?.messages?.message];

        for (const msg of messageList) {
            if (msg && msg?.address && msg?.amount) {
                messages.push({
                    address: msg.address,
                    amount: msg.amount,
                    stateInit: msg?.stateInit || undefined,
                    payload: msg?.payload || undefined,
                });
            }
        }
    }

    return {
        validUntil: parsedResponse?.validUntil
            ? parseInt(parsedResponse.validUntil)
            : undefined,
        network: (parsedResponse?.network as CHAIN) || undefined,
        from: parsedResponse?.from || undefined,
        messages: messages,
    } as TonConnectSendTransactionContent;
};

export default {
    name: "SEND_TRANSACTION_TONCONNECT",
    similes: ["SEND_TX_TONCONNECT", "SEND_TRANSACTION_TC"],
    description: "Send any transaction using TonConnect wallet integration.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State,
        _options?: Record<string, unknown>,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting SEND_TRANSACTION_TONCONNECT handler...");

        // exit if TONCONNECT is not used
        if (!runtime.getSetting("TON_MANIFEST_URL")) {
            return false;
        }

        try {
            const provider = await initTonConnectProvider(runtime);

            if (!provider.isConnected()) {
                if (callback) {
                    callback({
                        text: "Please connect your wallet first using the TON_CONNECT action.",
                        content: { error: "Wallet not connected" },
                    });
                }
                return false;
            }

            const transactionDetails =
                await buildTonConnectSendTransactionDetails(
                    runtime,
                    message,
                    state || ({} as State)
                );

            if (!isTonConnectSendTransactionContent(transactionDetails)) {
                console.error(
                    "Invalid content for SEND_TRANSACTION_TONCONNECT action."
                );
                if (callback) {
                    callback({
                        text: "Unable to process transaction request. Invalid content provided.",
                        content: { error: "Invalid transaction content" },
                    });
                }
                return false;
            }

            const action = new TonConnectSendTransactionAction();
            const boc = await action.sendTransaction(
                transactionDetails,
                provider
            );

            if (callback) {
                callback({
                    text: `Successfully sent transaction. Transaction: ${boc}`,
                    content: {
                        success: true,
                        boc: boc,
                        transaction: transactionDetails,
                    },
                });
            }

            return true;
        } catch (error) {
            console.error("Error during transaction:", error);
            if (callback) {
                callback({
                    text: `Error sending transaction: ${error instanceof Error ? error.message : String(error)}`,
                    content: {
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    },
                });
            }
            return false;
        }
    },
    template: tonConnectSendTransactionTemplate,
    validate: async (_runtime: IAgentRuntime) => {
        return true;
    },
    examples: [
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    text: "Send 1 TON to EQCGScrZe1xbyWqWDvdI6mzP-GAcAWFv6ZXuaJOuSqemxku4 with payload te6cckEBAQEAAgAAAEysuc0=",
                    action: "SEND_TRANSACTION_TONCONNECT",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Processing transaction via TonConnect...",
                    action: "SEND_TRANSACTION_TONCONNECT",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Successfully sent transaction. Transaction: c8ee4a2c1bd070005e6cd31b32270aa461c69b927c3f4c28b293c80786f78b43",
                },
            },
        ],
    ],
};

