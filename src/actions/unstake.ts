import {
    elizaLogger,
    composePromptFromState,
    type Content,
    type HandlerCallback,
    ModelType,
    parseKeyValueXml,
    type IAgentRuntime,
    type Memory,
    type State,
} from "@elizaos/core";
import { initStakingProvider, IStakingProvider } from "../providers/staking";

export interface UnstakeContent extends Content {
    poolId: string;
    amount: string | number;
}

function isUnstakeContent(content: Content): content is UnstakeContent {
    return (
        typeof content.poolId === "string" &&
        (typeof content.amount === "string" ||
            typeof content.amount === "number")
    );
}

const unstakeTemplate = `Extract the unstaking details from the recent messages.

Given the recent messages, extract the following information for unstaking TON:
- Pool identifier (poolId)
- Amount to unstake

Respond with the values in the following XML format:
<response>
<poolId>extracted pool id</poolId>
<amount>extracted amount</amount>
</response>

{{recentMessages}}

Extract the unstaking details and respond with values in the XML format above.`;

export class UnstakeAction {
    constructor(private stakingProvider: IStakingProvider) {}

    async unstake(params: UnstakeContent): Promise<string> {
        elizaLogger.log(
            `Unstaking: ${params.amount} TON from pool (${params.poolId})`
        );
        try {
            // Call the staking provider's unstake method.
            const result = await this.stakingProvider.unstake(
                params.poolId,
                Number(params.amount)
            );
            return result ?? "";
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            throw new Error(`Unstaking failed: ${errorMessage}`);
        }
    }
}

const buildUnstakeDetails = async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State
): Promise<UnstakeContent> => {
    if (!state) {
        state = (await runtime.composeState(message)) as State;
    }

    // Compose prompt from state
    const prompt = composePromptFromState({
        state,
        template: unstakeTemplate,
    });

    // Generate response using the small model
    const response = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
    });

    // Parse the XML response
    const responseText =
        typeof response === "string" ? response : (response as any).value || "";
    const parsedResponse = parseKeyValueXml(responseText);

    const unstakeContent: UnstakeContent = {
        poolId: parsedResponse?.poolId || "",
        amount: parsedResponse?.amount || "0",
        text: "", // Required by Content interface
    };

    return unstakeContent;
};

export default {
    name: "WITHDRAW_TON",
    similes: ["UNSTAKE_TOKENS", "WITHDRAW_TON", "TON_UNSTAKE"],
    description: "Withdraw TON tokens from a specified pool.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State,
        options?: any,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting WITHDRAW_TON handler...");
        const unstakeDetails = await buildUnstakeDetails(
            runtime,
            message,
            state || (await runtime.composeState(message))
        );

        if (!isUnstakeContent(unstakeDetails)) {
            elizaLogger.error("Invalid content for WITHDRAW_TON action.");
            if (callback) {
                callback({
                    text: "Invalid unstake details provided.",
                    content: { error: "Invalid unstake content" },
                });
            }
            return false;
        }

        try {
            const stakingProvider = await initStakingProvider(runtime);
            const action = new UnstakeAction(stakingProvider);
            const txHash = await action.unstake(unstakeDetails);

            if (callback) {
                callback({
                    text: `Successfully unstaked ${unstakeDetails.amount} TON from pool ${unstakeDetails.poolId}. Transaction: ${txHash}`,
                    content: {
                        success: true,
                        hash: txHash,
                        amount: unstakeDetails.amount,
                        poolId: unstakeDetails.poolId,
                    },
                });
            }
            return true;
        } catch (error) {
            elizaLogger.error("Error during unstaking:");
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            if (callback) {
                callback({
                    text: `Error unstaking TON: ${errorMessage}`,
                    content: { error: errorMessage },
                });
            }
            return false;
        }
    },
    template: unstakeTemplate,
    validate: async (runtime: IAgentRuntime) => true,
    examples: [
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    text: "Withdraw 1 TON from pool pool123",
                    action: "WITHDRAW_TON",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "I'll unstake 1 TON now...",
                    action: "WITHDRAW_TON",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Successfully unstaked 1 TON from pool pool123, Transaction: efgh5678abcd1234",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    text: "withdraw 12 TON from pool eqw237595asd432",
                    action: "WITHDRAW_TON",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Withdrawing 12 TON right now...",
                    action: "WITHDRAW_TON",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Successfully unstaked 12 TON from pool eqw237595asd432, Transaction: efgesdrf234h5678abcd1234",
                },
            },
        ],
    ],
};

