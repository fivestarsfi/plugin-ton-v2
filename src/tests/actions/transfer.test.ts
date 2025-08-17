import { describe, it, expect, beforeAll } from "bun:test";
import transferAction from "../../actions/transfer";

describe("Transfer Action", () => {
    it("should have correct metadata", () => {
        expect(transferAction.name).toBe("SEND_TON_TOKEN");
        expect(transferAction.description).toBe(
            "Call this action to send TON tokens to another wallet address. Supports sending any amount of TON to any valid TON wallet address. Transaction will be signed and broadcast to the TON blockchain."
        );
        expect(transferAction.similes).toContain("SEND_TON");
        expect(transferAction.similes).toContain("SEND_TON_TOKENS");
    });

    it("should validate transfer parameters", async () => {
        const runtime = {
            character: { name: "test", settings: {} },
            messageManager: {
                createMemory: async (memory: any) => memory,
            },
            getSetting: (key: string) =>
                key === "TON_EXPLORER_URL" ? "https://tonviewer.com/" : null,
        };

        const message = {
            userId: "user123",
            agentId: "agent123",
            roomId: "room123",
            content: {
                text: "transfer 1 TON to EQRecipient123",
                recipient: "EQRecipient123",
                amount: "1",
            },
        };

        const result = await transferAction.validate(runtime as any);
        expect(result).toBe(true);
    });

    it("should format transfer examples correctly", () => {
        expect(transferAction.examples).toBeDefined();
        expect(transferAction.examples.length).toBeGreaterThan(0);

        // Examples are arrays of messages
        const firstExampleSet = transferAction.examples[0];
        expect(Array.isArray(firstExampleSet)).toBe(true);
        expect(firstExampleSet.length).toBeGreaterThan(0);

        const firstMessage = firstExampleSet[0];
        expect(firstMessage).toHaveProperty("user");
        expect(firstMessage).toHaveProperty("content");
        expect(firstMessage.content).toHaveProperty("text");
    });
});
