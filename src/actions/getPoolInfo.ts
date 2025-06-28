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
import { initStakingProvider, IStakingProvider } from "../providers/staking";

export interface PoolInfoContent extends Content {
    poolId: string;
}

function isPoolInfoContent(content: Content): content is PoolInfoContent {
    return typeof content.poolId === "string";
}

const getPoolInfoTemplate = `Extract the pool information from the conversation.

{{recentMessages}}

Extract the pool identifier (TON address) for which to fetch staking pool information.

Respond with the extracted values in this XML format:
<values>
<poolId>TON_ADDRESS_HERE</poolId>
</values>`;

export class GetPoolInfoAction {
    constructor(private stakingProvider: IStakingProvider) {}

    async getPoolInfo(params: PoolInfoContent): Promise<any> {
        elizaLogger.log(`Fetching pool info for pool (${params.poolId})`);
        try {
            // Call the staking provider's getPoolInfo method.
            const poolInfo = await this.stakingProvider.getFormattedPoolInfo(
                params.poolId
            );
            return poolInfo;
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            throw new Error(`Fetching pool info failed: ${errorMessage}`);
        }
    }
}

const buildPoolInfoDetails = async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State
): Promise<PoolInfoContent> => {
    if (!state) {
        state = (await runtime.composeState(message)) as State;
    }

    const poolInfoContext = composePromptFromState({
        state,
        template: getPoolInfoTemplate,
    });

    const response = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt: poolInfoContext,
    });

    const parsedResponse = parseKeyValueXml(response);

    return {
        poolId: parsedResponse?.poolId || "",
    } as PoolInfoContent;
};

export default {
    name: "GET_POOL_INFO",
    similes: ["FETCH_POOL_INFO", "POOL_DATA", "GET_STAKING_INFO"],
    description:
        "Fetch detailed global staking pool information. Only perform if user is asking for a specific Pool Info, and NOT your stake.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State,
        options?: any,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting GET_POOL_INFO handler...");
        const poolInfoDetails = await buildPoolInfoDetails(
            runtime,
            message,
            state || (await runtime.composeState(message))
        );

        if (!isPoolInfoContent(poolInfoDetails)) {
            elizaLogger.error("Invalid content for GET_POOL_INFO action.");
            if (callback) {
                callback({
                    text: "Invalid pool info details provided.",
                    content: { error: "Invalid pool info content" },
                });
            }
            return false;
        }

        try {
            const stakingProvider = await initStakingProvider(runtime);
            const action = new GetPoolInfoAction(stakingProvider);
            const poolInfo = await action.getPoolInfo(poolInfoDetails);

            if (callback) {
                callback({
                    text: `Successfully fetched pool info: \n${poolInfo}`,
                    content: poolInfo,
                });
            }
            return true;
        } catch (error) {
            elizaLogger.error("Error fetching pool info:", error);
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            if (callback) {
                callback({
                    text: `Error fetching pool info: ${errorMessage}`,
                    content: { error: errorMessage },
                });
            }
            return false;
        }
    },
    template: getPoolInfoTemplate,
    validate: async (runtime: IAgentRuntime) => true,
    examples: [
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    text: "Get info for pool pool123",
                    action: "GET_POOL_INFO",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Fetching pool info...",
                    action: "GET_POOL_INFO",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: 'Fetched pool info for pool pool123: { "totalStaked": 1000, "rewardRate": 0.05, ...}',
                },
            },
        ],
    ],
};
