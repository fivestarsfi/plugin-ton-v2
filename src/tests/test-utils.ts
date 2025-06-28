import { IAgentRuntime, Memory, State } from "@elizaos/core";
import { KeyPair } from "@ton/crypto";

export function createMockRuntime(
    overrides?: Partial<IAgentRuntime>
): IAgentRuntime {
    return {
        character: { name: "test-agent", settings: {} },
        getSetting: (key: string) => {
            if (key === "TON_EXPLORER_URL")
                return "https://testnet.tonviewer.com/";
            if (key === "TON_RPC_URL")
                return "https://testnet.toncenter.com/api/v2/jsonRPC";
            return null;
        },
        messageManager: {
            createMemory: async (memory: Memory) => memory,
            updateMemory: async (memory: Memory) => memory,
            getMemories: async () => [],
        },
        stateManager: {
            getState: async () => ({ messages: [] }),
            updateState: async (state: State) => state,
        },
        useModel: async (modelType: any, options: any) => {
            return options.prompt || "Mock response";
        },
        ...overrides,
    } as any;
}

export function createMockWalletProvider(keypair?: KeyPair) {
    return {
        wallet: {
            address: {
                toString: () => "EQTest123456789",
                toRawString: () => "0:test123456789",
            },
            createTransfer: () => ({}),
            getSeqno: async () => 1,
            send: async () => {},
        },
        getWalletClient: () => ({
            open: (contract: any) => contract,
            sendTransaction: async () => ({ hash: "mockTxHash123" }),
            getContractState: async () => ({
                lastTransaction: { hash: "mockTxHash123" },
            }),
        }),
        keypair: keypair || {
            secretKey: Buffer.from("mock-secret-key"),
            publicKey: Buffer.from("mock-public-key"),
        },
    };
}

export function createMockMemory(overrides?: Partial<Memory>): Memory {
    return {
        id: "test-memory-id",
        userId: "test-user",
        agentId: "test-agent",
        roomId: "test-room",
        content: {
            text: "Test message",
            ...overrides?.content,
        },
        ...overrides,
    } as Memory;
}
