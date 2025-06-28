import { describe, it, expect, beforeEach } from "bun:test";
import evaaRepayAction from "../actions/evaaRepay";

describe("EVAA Repay Action", () => {
    it("should have correct metadata", () => {
        expect(evaaRepayAction.name).toBe("EVAA_REPAY");
        expect(evaaRepayAction.description).toBe(
            "Repay all repayed TON tokens to the EVAA lending protocol"
        );
        expect(evaaRepayAction.similes).toContain("REPAY_TON");
        expect(evaaRepayAction.similes).toContain("REPAY_ALL_TON");
        expect(evaaRepayAction.similes).toContain("REPAY_FULL_TON");
    });

    it("should have validate function", () => {
        expect(typeof evaaRepayAction.validate).toBe("function");
    });

    it("should have handler function", () => {
        expect(typeof evaaRepayAction.handler).toBe("function");
    });

    it("should have examples", () => {
        expect(Array.isArray(evaaRepayAction.examples)).toBe(true);
        expect(evaaRepayAction.examples?.length).toBeGreaterThan(0);

        // Check first example structure
        const firstExample = evaaRepayAction.examples?.[0];
        if (firstExample) {
            expect(Array.isArray(firstExample)).toBe(true);
            expect(firstExample.length).toBeGreaterThan(0);
            // expect(firstExample[0]).toHaveProperty("user"); // Removed in v1
            expect(firstExample[0]).toHaveProperty("content");
        }
    });
});
