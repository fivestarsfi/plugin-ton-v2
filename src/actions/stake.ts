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
import {
    IStakingProvider,
    StakingProvider,
    initStakingProvider,
} from "../providers/staking";
import { initWalletProvider } from "../providers/wallet";

export interface StakeContent extends Content {
    poolId: string;
    amount: string | number;
}

function isStakeContent(content: Content): content is StakeContent {
    return (
        typeof content.poolId === "string" &&
        (typeof content.amount === "string" ||
            typeof content.amount === "number")
    );
}

const stakeTemplate = `Extract the staking details from the recent messages.

Given the recent messages, extract the following information for staking TON:
- Pool identifier (poolId)
- Amount to stake

Respond with the values in the following XML format:
<response>
<poolId>extracted pool id</poolId>
<amount>extracted amount</amount>
</response>

{{recentMessages}}

Extract the staking details and respond with values in the XML format above.`;

/**
 * Modified StakeAction class that uses the nativeStakingProvider which
 * internally leverages the current wallet provider to construct and send
 * on-chain transactions.
 */
export class StakeAction {
    constructor(private stakingProvider: IStakingProvider) {}

    async stake(params: StakeContent): Promise<string | null> {
        elizaLogger.log(
            `Staking: ${params.amount} TON in pool (${params.poolId}) using wallet provider`
        );
        try {
            return await this.stakingProvider.stake(
                params.poolId,
                Number(params.amount)
            );
        } catch (error) {
            throw new Error(
                `Staking failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
}

const buildStakeDetails = async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State
): Promise<StakeContent> => {
    // Initialize or update state
    if (!state) {
        state = (await runtime.composeState(message)) as State;
    }

    // Compose prompt from state
    const prompt = composePromptFromState({
        state,
        template: stakeTemplate,
    });

    // Generate response using the small model
    const response = await runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
    });

    // Parse the XML response
    const parsedResponse = parseKeyValueXml(response as string);

    const stakeContent: StakeContent = {
        poolId: parsedResponse?.poolId || "",
        amount: parsedResponse?.amount || "0",
        text: "", // Required by Content interface
    };

    return stakeContent;
};

export default {
    name: "DEPOSIT_TON",
    similes: ["STAKE_TOKENS", "DEPOSIT_TON", "DEPOSIT_TOKEN"],
    description: "Deposit TON tokens in a specified pool.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State,
        options?: any,
        callback?: HandlerCallback
    ) => {
        elizaLogger.log("Starting DEPOSIT_TON handler...");
        const stakeDetails = await buildStakeDetails(
            runtime,
            message,
            state || (await runtime.composeState(message))
        );

        if (!isStakeContent(stakeDetails)) {
            elizaLogger.error("Invalid content for DEPOSIT_TON action.");
            if (callback) {
                callback({
                    text: "Invalid staking details provided.",
                    content: { error: "Invalid staking content" },
                });
            }
            return false;
        }

        try {
            const walletProvider = await initWalletProvider(runtime);
            const stakingProvider = await initStakingProvider(runtime);
            // Instantiate StakeAction with the native staking provider.
            const action = new StakeAction(stakingProvider);
            const txHash = await action.stake(stakeDetails);

            if (callback) {
                callback({
                    text: `Successfully staked ${stakeDetails.amount} TON in pool ${stakeDetails.poolId}. Transaction: ${txHash}`,
                    content: {
                        success: true,
                        hash: txHash,
                        amount: stakeDetails.amount,
                        poolId: stakeDetails.poolId,
                    },
                });
            }
            return true;
        } catch (error) {
            elizaLogger.error("Error during staking:", error);
            if (callback) {
                callback({
                    text: `Error staking TON: ${error instanceof Error ? error.message : String(error)}`,
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
    template: stakeTemplate,
    validate: async (runtime: IAgentRuntime) => {
        elizaLogger.info("VALIDATING TON STAKING ACTION");
        return true;
    },
    examples: [
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    text: "Deposit 1.5 TON in pool pool123",
                    action: "DEPOSIT_TON",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "I'll deposit 1.5 TON now...",
                    action: "DEPOSIT_TON",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Successfully deposited 1.5 TON in pool pool123, Transaction: abcd1234efgh5678",
                },
            },
        ],
    ],
};
