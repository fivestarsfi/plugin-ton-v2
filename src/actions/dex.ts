// pool creation, liquidity provisioning, and management

import {
    composePromptFromState,
    parseKeyValueXml,
    Content,
    elizaLogger,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelType,
    State,
} from "@elizaos/core";
import {
    initWalletProvider,
    nativeWalletProvider,
    WalletProvider,
} from "../providers/wallet";
import {
    base64ToHex,
    sanitizeTonAddress,
    sleep,
    waitSeqnoContract,
} from "../utils/util";
import { SUPPORTED_DEXES } from "../providers/dexes";
import { DexProvider } from "../providers/dex";
import { Address, JettonMaster } from "@ton/ton";

// Interface for DEX action content
interface DexActionContent extends Content {
    operation: "CREATE_POOL" | "DEPOSIT" | "WITHDRAW" | "CLAIM_FEE";
    dex: string;
    tokenA?: string;
    amountA?: number;
    tokenB?: string;
    amountB?: number;
    isTon?: boolean;
    tonAmount?: number;
    pool?: string;
    liquidity?: number;
}

const dexTemplate = `Extract the DEX operation information from the conversation.

{{recentMessages}}

Extract the DEX operation details:
- operation: One of CREATE_POOL, DEPOSIT, WITHDRAW, CLAIM_FEE
- dex: DEX name (one of: ${SUPPORTED_DEXES.join(", ")})
- tokenA: First token address (optional)
- amountA: Amount of first token (optional)
- tokenB: Second token address (optional)
- amountB: Amount of second token (optional)
- isTon: Whether this involves TON (true/false, optional)
- tonAmount: Amount of TON (optional)
- pool: Pool address (for CLAIM_FEE)
- liquidity: Liquidity amount (for DEPOSIT/WITHDRAW/CLAIM_FEE)

Rules:
- For CREATE_POOL: Requires tokenA/amountA and either tokenB/amountB or isTon/tonAmount
- For DEPOSIT/WITHDRAW: Requires either tokenA/amountA or isTon/tonAmount, plus liquidity
- For CLAIM_FEE: Requires pool address and liquidity amount

Respond with the extracted values in this XML format:
<values>
<operation>OPERATION_TYPE</operation>
<dex>DEX_NAME</dex>
<tokenA>TOKEN_ADDRESS_OR_EMPTY</tokenA>
<amountA>AMOUNT_OR_EMPTY</amountA>
<tokenB>TOKEN_ADDRESS_OR_EMPTY</tokenB>
<amountB>AMOUNT_OR_EMPTY</amountB>
<isTon>TRUE_FALSE_OR_EMPTY</isTon>
<tonAmount>AMOUNT_OR_EMPTY</tonAmount>
<pool>POOL_ADDRESS_OR_EMPTY</pool>
<liquidity>LIQUIDITY_AMOUNT_OR_EMPTY</liquidity>
</values>`;

export class DexAction {
    private walletProvider: WalletProvider;
    private dexProvider: DexProvider;

    constructor(walletProvider: WalletProvider, dexProvider: DexProvider) {
        this.walletProvider = walletProvider;
        this.dexProvider = dexProvider;
        elizaLogger.debug(
            "DexAction initialized with wallet and DEX providers"
        );
    }

    private async executeOperation(params: DexActionContent): Promise<string> {
        elizaLogger.debug(
            `Executing DEX operation: ${params.operation} on ${params.dex}`,
        );

        const walletClient = this.walletProvider.getWalletClient();
        const contract = walletClient.open(this.walletProvider.wallet);
        const seqno = await contract.getSeqno();
        elizaLogger.debug(`Current wallet seqno: ${seqno}`);

        const jettonDeposits = [];
        if (params.tokenA) {
            elizaLogger.debug(
                `Adding token A to jetton deposits: ${params.tokenA}, amount: ${params.amountA}`
            );

            try {
                const tokenAddress = Address.parse(params.tokenA);
                elizaLogger.debug(
                    `Token A address parsed successfully: ${tokenAddress.toString()}`
                );

                jettonDeposits.push({
                    jetton: new JettonMaster(tokenAddress),
                    amount: params.amountA || 0,
                });
                elizaLogger.debug(
                    `Token A added to deposits with amount: ${params.amountA}`
                );
            } catch (error) {
                elizaLogger.error(
                    `Error parsing token A address: ${error instanceof Error ? error.message : String(error)}`
                );
                throw new Error(
                    `Invalid token A address: ${params.tokenA}. Error: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        if (params.tokenB) {
            elizaLogger.debug(
                `Adding token B to jetton deposits: ${params.tokenB}, amount: ${params.amountB}`
            );

            try {
                const tokenAddress = Address.parse(params.tokenB);
                elizaLogger.debug(
                    `Token B address parsed successfully: ${tokenAddress.toString()}`
                );

                jettonDeposits.push({
                    jetton: new JettonMaster(tokenAddress),
                    amount: params.amountB || 0,
                });
                elizaLogger.debug(
                    `Token B added to deposits with amount: ${params.amountB}`
                );
            } catch (error) {
                elizaLogger.error(
                    `Error parsing token B address: ${error instanceof Error ? error.message : String(error)}`
                );
                throw new Error(
                    `Invalid token B address: ${params.tokenB}. Error: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        elizaLogger.debug(
            `Final jetton deposits configuration:`);

        try {
            switch (params.operation) {
                case "CREATE_POOL":
                    elizaLogger.debug("Creating pool with parameters:");

                    elizaLogger.debug(
                        `Calling DEX provider createPool method for ${params.dex}`
                    );
                    const createPoolResult = await this.dexProvider.createPool({
                        dex: params.dex,
                        jettonDeposits,
                        isTon: params.isTon || false,
                        tonAmount: params.tonAmount || 0,
                    });
                    elizaLogger.debug(
                        `Pool creation request sent successfully, result:`,
                        createPoolResult
                    );
                    break;

                case "DEPOSIT":
                    elizaLogger.debug("Depositing liquidity with parameters:");

                    elizaLogger.debug(
                        `Calling DEX provider depositLiquidity method for ${params.dex}`
                    );
                    const depositResult =
                        await this.dexProvider.depositLiquidity({
                            dex: params.dex,
                            jettonDeposits,
                            isTon: params.isTon || false,
                            tonAmount: params.tonAmount || 0,
                        });
                    elizaLogger.debug(
                        `Liquidity deposit request sent successfully, result:`,
                    );
                    break;

                case "WITHDRAW":
                    elizaLogger.debug(
                        "Withdrawing liquidity with parameters:"
                    );

                    elizaLogger.debug(
                        `Calling DEX provider withdrawLiquidity method for ${params.dex}`
                    );
                    const withdrawResult =
                        await this.dexProvider.withdrawLiquidity({
                            dex: params.dex,
                            jettonWithdrawals: jettonDeposits,
                            isTon: params.isTon || false,
                            amount: params.liquidity?.toString(),
                        });
                    elizaLogger.debug(
                        `Liquidity withdrawal request sent successfully, result:`,
                        withdrawResult
                    );
                    break;

                case "CLAIM_FEE":
                    elizaLogger.debug("Claiming fees with parameters:");

                    elizaLogger.debug(
                        `Calling DEX provider claimFees method for ${params.dex}`
                    );
                    const claimResult = await this.dexProvider.claimFees({
                        dex: params.dex,
                        pool: params.pool || "",
                        feeClaimAmount: params.liquidity || 0,
                    });
                    elizaLogger.debug(
                        `Fee claim request sent successfully, result:`
                    );
                    break;
            }

            elizaLogger.debug(
                `Waiting for transaction confirmation (seqno: ${seqno})...`
            );
            await waitSeqnoContract(seqno, contract);
            elizaLogger.debug("Transaction confirmed successfully");

            const state = await walletClient.getContractState(
                this.walletProvider.wallet.address
            );
            if (!state.lastTransaction) {
                throw new Error("No last transaction found");
            }
            const txHash = base64ToHex(state.lastTransaction.hash);
            elizaLogger.debug(`Transaction hash: ${txHash}`);

            return txHash;
        } catch (error) {
            elizaLogger.error("Error executing DEX operation:");
            elizaLogger.error("Operation details:" 
            );

            // Enhanced error logging
            if (
                error instanceof Error &&
                error.message &&
                error.message.includes("exit_code:")
            ) {
                const exitCodeMatch = error.message.match(/exit_code: (-?\d+)/);
                const exitCode = exitCodeMatch ? exitCodeMatch[1] : "unknown";
                elizaLogger.error(
                    `DEX operation failed with exit code: ${exitCode}`
                );

                if (exitCode === "-13") {
                    elizaLogger.error(
                        "Exit code -13 typically indicates insufficient balance, non-existent pool, or incorrect parameters"
                    );
                }
            }

            if (error instanceof Error && error.stack) {
                elizaLogger.error("Error stack trace:");
            }

            throw new Error(
                `DEX operation failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    async run(params: DexActionContent): Promise<string> {
        elizaLogger.debug(
            `Starting DEX operation: ${params.operation} on ${params.dex}`
        );

        // Check if the operation is supported by the selected DEX
        const supportedMethods =
            this.dexProvider
                .getAllDexesAndSupportedMethods()
                .find((dex) => dex.dex === params.dex.toUpperCase())
                ?.supportedMethods || [];

        elizaLogger.debug(
            `DEX ${params.dex} supported methods:`,
            supportedMethods
        );

        if (!supportedMethods.includes(params.operation)) {
            const error = `Operation ${params.operation} is not supported by ${params.dex}`;
            elizaLogger.error(error);
            throw new Error(error);
        }

        const result = await this.executeOperation(params);
        elizaLogger.debug(
            `DEX operation completed successfully with hash: ${result}`
        );
        return result;
    }
}

const buildDexActionDetails = async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State
): Promise<DexActionContent> => {
    const walletInfo = await nativeWalletProvider.get(runtime, message, state);
    state.walletInfo = walletInfo;

    let currentState = state;
    if (!currentState) {
        currentState = (await runtime.composeState(message)) as State;
    }

    const actionContext = composePromptFromState({
        state: currentState,
        template: dexTemplate,
    });

    const response = await runtime.useModel(ModelType.SMALL, {
        prompt: actionContext,
    });

    const parsedResponse = parseKeyValueXml(response);

    return {
        operation: (parsedResponse?.operation as any) || "CREATE_POOL",
        dex: parsedResponse?.dex || "",
        tokenA: parsedResponse?.tokenA || undefined,
        amountA: parsedResponse?.amountA
            ? parseFloat(parsedResponse.amountA)
            : undefined,
        tokenB: parsedResponse?.tokenB || undefined,
        amountB: parsedResponse?.amountB
            ? parseFloat(parsedResponse.amountB)
            : undefined,
        isTon:
            parsedResponse?.isTon === "true" ||
            parsedResponse?.isTon === "TRUE",
        tonAmount: parsedResponse?.tonAmount
            ? parseFloat(parsedResponse.tonAmount)
            : undefined,
        pool: parsedResponse?.pool || undefined,
        liquidity: parsedResponse?.liquidity
            ? parseFloat(parsedResponse.liquidity)
            : undefined,
    } as DexActionContent;
};

export default {
    name: "MANAGE_LIQUIDITY_POOLS",
    similes: ["CREATE_POOL", "DEPOSIT_POOL", "WITHDRAW_POOL", "CLAIM_FEE"],
    description:
        "Manage liquidity pools: create new pools, deposit liquidity, withdraw liquidity and claim fees",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State,
        _options?: any,
        callback?: HandlerCallback
    ) => {
        elizaLogger.debug("Starting DEX operation handler...");

        try {
            elizaLogger.debug("Building DEX action details from user input...");
            const dexActionDetails = await buildDexActionDetails(
                runtime,
                message,
                state || (await runtime.composeState(message))
            );
            elizaLogger.debug(
                "DEX action details extracted:",
            );

            elizaLogger.debug("Initializing wallet provider...");
            const walletProvider = await initWalletProvider(runtime);
            elizaLogger.debug(
                `Wallet initialized with address: ${walletProvider.wallet.address.toString()}`
            );

            elizaLogger.debug("Initializing DEX provider...");
            const dexProvider = new DexProvider(walletProvider);
            elizaLogger.debug(
                "Available DEXes:"
            );

            elizaLogger.debug("Creating DEX action instance...");
            const action = new DexAction(walletProvider, dexProvider);

            elizaLogger.debug(
                `Executing DEX operation: ${dexActionDetails.operation} on ${dexActionDetails.dex}...`
            );
            const hash = await action.run(dexActionDetails);
            elizaLogger.debug(`DEX operation completed with hash: ${hash}`);

            if (callback) {
                const operationMap = {
                    CREATE_POOL: "created pool",
                    DEPOSIT: "deposited liquidity",
                    WITHDRAW: "withdrawn liquidity",
                    CLAIM_FEE: "claimed fees",
                };

                const responseText = `Successfully ${operationMap[dexActionDetails.operation]}. Transaction hash: ${hash}`;
                elizaLogger.debug(`Sending response to user: ${responseText}`);

                callback({
                    text: responseText,
                    content: {
                        success: true,
                        hash: hash,
                        operation: dexActionDetails.operation,
                    },
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error("Error during DEX operation:");
            if (callback) {
                callback({
                    text: `Error performing DEX operation: ${error instanceof Error ? error.message : String(error)}`,
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
    template: dexTemplate,
    validate: async (_runtime: IAgentRuntime) => true,
    examples: [
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    text: "Create a new liquidity pool with 100 TON and 100 USDC token (address: EQCGScrZe1xbyWqWDvdI6mzP-GAcAWFv6ZXuaJOuSqemxku4)",
                    action: "MANAGE_LIQUIDITY_POOLS",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Successfully created pool. Transaction hash: 0x123abc...",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    text: "Deposit 50 TON and 100 USDC (EQCGScrZe1xbyWqWDvdI6mzP-GAcAWFv6ZXuaJOuSqemxku4) into the pool with 75 liquidity units",
                    action: "MANAGE_LIQUIDITY_POOLS",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Successfully deposited liquidity. Transaction hash: 0x456def...",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    text: "Withdraw 75 liquidity units from the TON-USDC pool at EQCGScrZe1xbyWqWDvdI6mzP-GAcAWFv6ZXuaJOuSqemxku4",
                    action: "MANAGE_LIQUIDITY_POOLS",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Successfully withdrawn liquidity. Transaction hash: 0x789ghi...",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                name: "{{user1}}",
                content: {
                    text: "Claim 10 units of fees from pool EQCGScrZe1xbyWqWDvdI6mzP-GAcAWFv6ZXuaJOuSqemxku4",
                    action: "MANAGE_LIQUIDITY_POOLS",
                },
            },
            {
                user: "assistant",
                name: "{{agent}}",
                content: {
                    text: "Successfully claimed fees. Transaction hash: 0x012jkl...",
                },
            },
        ],
    ],
};

