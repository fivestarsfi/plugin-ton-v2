import { describe, it, expect } from "bun:test";
import unstakeAction from "../actions/unstake";

describe("Unstake Action", () => {
    it("should have correct metadata", () => {
        expect(unstakeAction.name).toBe("WITHDRAW_TON");
        expect(unstakeAction.description).toBe(
            "Withdraw TON tokens from a specified pool."
        );
        expect(unstakeAction.similes).toContain("UNSTAKE_TOKENS");
        expect(unstakeAction.similes).toContain("WITHDRAW_TON");
        expect(unstakeAction.similes).toContain("TON_UNSTAKE");
    });

    it("should have validate function", () => {
        expect(typeof unstakeAction.validate).toBe("function");
    });

    it("should have handler function", () => {
        expect(typeof unstakeAction.handler).toBe("function");
    });

    it("should have examples", () => {
        expect(Array.isArray(unstakeAction.examples)).toBe(true);
        expect(unstakeAction.examples.length).toBeGreaterThan(0);

        // Check first example structure
        const firstExample = unstakeAction.examples[0];
        expect(Array.isArray(firstExample)).toBe(true);
        expect(firstExample.length).toBeGreaterThan(0);
        expect(firstExample[0]).toHaveProperty("user");
        expect(firstExample[0]).toHaveProperty("content");
    });

    it("should have correct template format", () => {
        const template = unstakeAction.template;
        expect(template).toContain("{{recentMessages}}");
        expect(template).toContain("<response>");
        expect(template).toContain("</response>");
    });
});
