import { describe, it, expect } from "bun:test";
import evaaWithdrawAction from "../actions/evaaWithdraw";

describe("EVAA Withdraw Action", () => {
    it("should have correct metadata", () => {
        expect(evaaWithdrawAction.name).toBe("EVAA_WITHDRAW");
        expect(evaaWithdrawAction.description).toBe(
            "Withdraw TON tokens from the EVAA lending protocol"
        );
        expect(evaaWithdrawAction.similes).toContain("WITHDRAW_TON");
        expect(evaaWithdrawAction.similes).toContain("REMOVE_TON");
        expect(evaaWithdrawAction.similes).toContain("REDEEM_TON");
    });

    it("should have validate function", () => {
        expect(typeof evaaWithdrawAction.validate).toBe("function");
    });

    it("should have handler function", () => {
        expect(typeof evaaWithdrawAction.handler).toBe("function");
    });

    it("should have examples", () => {
        expect(Array.isArray(evaaWithdrawAction.examples)).toBe(true);
        expect(evaaWithdrawAction.examples?.length).toBeGreaterThan(0);

        // Check first example structure
        const firstExample = evaaWithdrawAction.examples?.[0];
        if (firstExample) {
            expect(Array.isArray(firstExample)).toBe(true);
            expect(firstExample.length).toBeGreaterThan(0);
            // expect(firstExample[0]).toHaveProperty("user"); // Removed in v1
            expect(firstExample[0]).toHaveProperty("content");
        }
    });
});
