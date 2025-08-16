import { describe, it, expect } from "bun:test";
import evaaSupplyAction from "../actions/evaaSupply";

describe("EVAA Supply Action", () => {
    it("should have correct metadata", () => {
        expect(evaaSupplyAction.name).toBe("EVAA_SUPPLY");
        expect(evaaSupplyAction.description).toBe(
            "Supply/lend TON, USDT and USDC tokens to the EVAA lending protocol"
        );
        expect(evaaSupplyAction.similes).toContain("LEND");
        expect(evaaSupplyAction.similes).toContain("LEND_TON");
        expect(evaaSupplyAction.similes).toContain("SUPPLY_TON");
    });

    it("should have validate function", () => {
        expect(typeof evaaSupplyAction.validate).toBe("function");
    });

    it("should have handler function", () => {
        expect(typeof evaaSupplyAction.handler).toBe("function");
    });

    it("should have examples", () => {
        expect(Array.isArray(evaaSupplyAction.examples)).toBe(true);
        expect(evaaSupplyAction.examples?.length).toBeGreaterThan(0);

        // Check first example structure
        const firstExample = evaaSupplyAction.examples?.[0];
        if (firstExample) {
            expect(Array.isArray(firstExample)).toBe(true);
            expect(firstExample.length).toBeGreaterThan(0);
            // expect(firstExample[0]).toHaveProperty("user"); // Removed in v1
            expect(firstExample[0]).toHaveProperty("content");
        }
    });
});

