import { describe, it, expect, beforeEach } from "bun:test";
import evaaBorrowAction from "../actions/evaaBorrow";

describe("EVAA Borrow Action", () => {
    it("should have correct metadata", () => {
        expect(evaaBorrowAction.name).toBe("EVAA_BORROW");
        expect(evaaBorrowAction.description).toBe(
            "Borrow TON, USDT and USDC tokens from the EVAA lending protocol"
        );
        expect(evaaBorrowAction.similes).toContain("BORROW_TON");
        expect(evaaBorrowAction.similes).toContain("BORROW_USDT");
        expect(evaaBorrowAction.similes).toContain("BORROW_USDC");
    });

    it("should have validate function", () => {
        expect(typeof evaaBorrowAction.validate).toBe("function");
    });

    it("should have handler function", () => {
        expect(typeof evaaBorrowAction.handler).toBe("function");
    });

    it("should have examples", () => {
        expect(Array.isArray(evaaBorrowAction.examples)).toBe(true);
        expect(evaaBorrowAction.examples?.length).toBeGreaterThan(0);

        // Check first example structure
        const firstExample = evaaBorrowAction.examples?.[0];
        if (firstExample) {
            expect(Array.isArray(firstExample)).toBe(true);
            expect(firstExample.length).toBeGreaterThan(0);
            // expect(firstExample[0]).toHaveProperty("user"); // Removed in v1
            expect(firstExample[0]).toHaveProperty("content");
        }
    });
});

