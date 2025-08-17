import {
    elizaLogger,
    parseKeyValueXml,
    type Content,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    type State,
} from "@elizaos/core";
import { sleep, base64ToHex, formatCurrency } from "../utils/util";
import {
    initWalletProvider,
    type WalletProvider,
    nativeWalletProvider,
} from "../providers/wallet";
import {
    Evaa,
    FEES,
    MAINNET_LP_POOL_CONFIG,
    MAINNET_POOL_CONFIG,
    PricesCollector,
    TESTNET_POOL_CONFIG,
    TON_MAINNET,
    TONUSDT_DEDUST_MAINNET,
} from "@evaafi/sdk";
import { Address, fromNano, internal } from "@ton/ton";

// TODO: add lending protocol name to support multiple lending protocols
export interface LendingInfoContent extends Content {
    userAddress: string;
}

function isLendingInfoContent(content: Content): content is LendingInfoContent {
    console.log("Content for geting lending info", content);
    return typeof content.userAddress === "string";
}

interface ActionOptions {
    [key: string]: unknown;
}

type LendingDataActive = {
    type: "active";
    borrowBalance: string;
    supplyBalance: string;
    availableToBorrow: string;
    debtLimitUsedPercent: string;
    healthFactor: number;
};

type LendingDataInactive = {
    type: "inactive";
};

type LendingData = LendingDataActive | LendingDataInactive;

/**
 * Template guiding the extraction of user data parameters for getting of lending protocol info.
 * The output should be a JSON markdown block similar to:
 *
 * {
 *   "userAddress": "EQCGScrZe1xbyWqWDvdI6mzP-GAcAWFv6ZXuaJOuSqemxku4"
 * }
 */
const getLendingInfoTemplate = `Extract the lending information from the conversation.

{{recentMessages}}

Extract the user address (TON address) for which to fetch lending info.

Respond with the extracted values in this XML format:
<values>
<userAddress>TON_ADDRESS_HERE</userAddress>
</values>`;

function createLendingInfoResponseText(
    lendingInfo: LendingData,
    userAddress: string
) {
    if (lendingInfo.type === "inactive") {
        return `Lending contract for ${userAddress} is inactive, seems like user hasn't interacted with it yet`;
    }

    return `Lending info for user address ${userAddress}
Borrow balance: ${lendingInfo.borrowBalance}$
Supply balance: ${lendingInfo.supplyBalance}$
Available to borrow: ${lendingInfo.availableToBorrow}$
Debt limit already used: ${lendingInfo.debtLimitUsedPercent}%
Health factor (account could be liquidated if < 0): ${lendingInfo.healthFactor}`;
}

export class GetLendingInfoAction {
    private readonly walletProvider: WalletProvider;

    constructor(walletProvider: WalletProvider) {
        this.walletProvider = walletProvider;
    }

    async getLendingInfo(params: LendingInfoContent): Promise<LendingData> {
        // console.log(`Getting lending info for user: ${params.userAddress}`);
        // {  "userAddress": "EQCGScrZe1xbyWqWDvdI6mzP-GAcAWFv6ZXuaJOuSqemxku4" }

        const walletClient = this.walletProvider.getWalletClient();

        try {
            const evaa = walletClient.open(
                new Evaa({ poolConfig: MAINNET_LP_POOL_CONFIG })
            );

            const userAddress = Address.parse(params.userAddress);

            await evaa.getSync();
            const pricesCollector = new PricesCollector(MAINNET_LP_POOL_CONFIG);
            const priceData = await pricesCollector.getPrices();

            const user = evaa.getOpenedUserContract(userAddress);

            await user.getSync(
                evaa.data!.assetsData,
                evaa.data!.assetsConfig,
                priceData!.dict
            );

            if (!user.data || user.data.type === "inactive") {
                // return "Lending contract for this user is inactive, seems like he hasn't interacted with it yet";
                return {
                    type: "inactive",
                };
            }

            // Type guard to ensure we have active user data
            const activeData = user.data as any; // We know it's active if not inactive

            return {
                type: "active",
                borrowBalance: formatCurrency(
                    fromNano(activeData.borrowBalance || 0n),
                    2
                ),
                supplyBalance: formatCurrency(
                    fromNano(activeData.supplyBalance || 0n),
                    2
                ),
                availableToBorrow: formatCurrency(
                    fromNano(activeData.availableToBorrow || 0n),
                    2
                ),
                debtLimitUsedPercent: formatCurrency(
                    (activeData.limitUsedPercent || 0).toString(),
                    2
                ),
                healthFactor: activeData.healthFactor || 0,
            };
        } catch (error) {
            elizaLogger.error("Error getting lending info:");
            throw error;
        }
    }
}

const buildGetLendingInfo = async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State
): Promise<LendingInfoContent> => {
    // Initialize or update state
    let currentState = state;
    if (!currentState) {
        currentState = (await runtime.composeState(message)) as State;
    }

    // Compose lending info getter context
    const getLendingInfoContext = getLendingInfoTemplate.replace(
        "{{recentMessages}}",
        (currentState.recentMessages || [])
            .map(
                (msg: Memory) =>
                    `${(msg as any).userId || "user"}: ${msg.content.text}`
            )
            .join("\n")
    );

    // For now, we'll just parse the template directly since the model call is not available
    const response = { text: getLendingInfoContext };

    // Extract userAddress from the message content or state
    const messageText = message.content.text || "";
    const addressMatch = messageText.match(/(?:EQ|UQ)[A-Za-z0-9_-]{46}/);
    const parsedResponse = addressMatch
        ? { userAddress: addressMatch[0] }
        : null;

    const getLendingInfoContent: LendingInfoContent = {
        userAddress: parsedResponse?.userAddress || "",
    };

    return getLendingInfoContent;
};

export default {
    name: "GET_LENDING_INFO",
    similes: ["FETCH_LENDING_DATA", "GET_LENDING_DATA", "SHOW_LENDING_INFO"],
    description:
        "Call this action to get lending info (current borrow/supply rates and liquidation risks) for user address",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State,
        _options?: ActionOptions,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting GET_LENDING_INFO handler...");

        const getLendingInfoDetails = await buildGetLendingInfo(
            runtime,
            message,
            state || ({} as State)
        );

        // validate model-provided content
        if (!isLendingInfoContent(getLendingInfoDetails)) {
            console.error("Invalid content for GET_LENDING_INFO action.");
            if (callback) {
                callback({
                    text: "Unable to process get lending data request. Invalid content provided.",
                    content: { error: "Invalid transfer content" },
                });
            }
            return false;
        }

        try {
            const walletProvider = await initWalletProvider(runtime);
            const action = new GetLendingInfoAction(walletProvider);
            const lendingInfo = await action.getLendingInfo(
                getLendingInfoDetails
            );

            if (callback) {
                const lendingInfoResponseText = createLendingInfoResponseText(
                    lendingInfo,
                    getLendingInfoDetails.userAddress
                );

                callback({
                    text: lendingInfoResponseText,
                    content: lendingInfo,
                });
            }

            return true;
        } catch (error) {
            console.error("Error during getting lending info:", error);
            if (callback) {
                callback({
                    text: `Error getting lending info: ${error instanceof Error ? error.message : "Unknown error"}`,
                    content: {
                        error:
                            error instanceof Error
                                ? error.message
                                : "Unknown error",
                    },
                });
            }
            return false;
        }
    },
    template: getLendingInfoTemplate,
    // eslint-disable-next-line
    validate: async (_runtime: IAgentRuntime) => {
        //console.log("Validating TON transfer from user:", message.userId);
        return true;
    },
    examples: [
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    text: "Show lending info for EQCGScrZe1xbyWqWDvdI6mzP-GAcAWFv6ZXuaJOuSqemxku4",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "I'll get lending info now",
                    action: "GET_LENDING_INFO",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: `Lending info for user address EQCGScrZe1xbyWqWDvdI6mzP-GAcAWFv6ZXuaJOuSqemxku4
Borrow balance: 50$
Supply balance: 10$
Available to borrow: 30.5$
Debt limit already used: 39%
Health factor (account could be liquidated if < 0): 0.32`,
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    text: "Get lending info for EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Sure, getting lending info for EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N...",
                    action: "GET_LENDING_INFO",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: `Lending info for user address EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N
Borrow balance: 102.1$
Supply balance: 70$
Available to borrow: 21.2$
Debt limit already used: 15%
Health factor (account could be liquidated if < 0): 0.72`,
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    text: "Show me lending info in TON blockchain for EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "I will get lending info for EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N...",
                    action: "GET_LENDING_INFO",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: `Lending info for user address EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N
Borrow balance: 22$
Supply balance: 2112$
Available to borrow: 2932$
Debt limit already used: 53%
Health factor (account could be liquidated if < 0): 0.133`,
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    text: "I want to see lending info for EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Getting lending info for EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N...",
                    action: "GET_LENDING_INFO",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Lending contract for EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N is inactive, seems like user hasn't interacted with it yet",
                },
            },
        ],
    ],
};
