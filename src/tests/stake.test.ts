import { describe, it, expect } from "bun:test";
import stakeAction from "../actions/stake";

describe("Stake Action", () => {
    it("should have correct metadata", () => {
        expect(stakeAction.name).toBe("DEPOSIT_TON");
        expect(stakeAction.description).toBe(
            "Deposit TON tokens in a specified pool."
        );
        expect(stakeAction.similes).toContain("STAKE_TOKENS");
        expect(stakeAction.similes).toContain("DEPOSIT_TON");
        expect(stakeAction.similes).toContain("DEPOSIT_TOKEN");
    });

    it("should have validate function", () => {
        expect(typeof stakeAction.validate).toBe("function");
    });

    it("should have handler function", () => {
        expect(typeof stakeAction.handler).toBe("function");
    });

    it("should have examples", () => {
        expect(Array.isArray(stakeAction.examples)).toBe(true);
        expect(stakeAction.examples.length).toBeGreaterThan(0);

        // Check first example structure
        const firstExample = stakeAction.examples[0];
        expect(Array.isArray(firstExample)).toBe(true);
        expect(firstExample.length).toBeGreaterThan(0);
        expect(firstExample[0]).toHaveProperty("user");
        expect(firstExample[0]).toHaveProperty("content");
    });

    it("should have correct template format", () => {
        const template = stakeAction.template;
        expect(template).toContain("{{recentMessages}}");
        expect(template).toContain("<response>");
        expect(template).toContain("</response>");
    });
});
