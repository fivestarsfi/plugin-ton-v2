import { describe, it, expect } from "bun:test";
import evaaPositionsAction from "../actions/evaaPositions";

describe("EVAA Positions Action", () => {
    it("should have correct metadata", () => {
        expect(evaaPositionsAction.name).toBe("EVAA_POSITIONS");
        expect(evaaPositionsAction.description).toBe(
            "Calculates and displays accrued interest and health factors for borrowed positions"
        );
        expect(evaaPositionsAction.similes).toContain("BORROW_POSITIONS");
        expect(evaaPositionsAction.similes).toContain("GET_BORROW_POSITIONS");
        expect(evaaPositionsAction.similes).toContain(
            "VIEW_BORROWED_POSITIONS"
        );
    });

    it("should have validate function", () => {
        expect(typeof evaaPositionsAction.validate).toBe("function");
    });

    it("should have handler function", () => {
        expect(typeof evaaPositionsAction.handler).toBe("function");
    });

    it("should have examples", () => {
        expect(Array.isArray(evaaPositionsAction.examples)).toBe(true);
        expect(evaaPositionsAction.examples?.length).toBeGreaterThan(0);

        // Check first example structure
        const firstExample = evaaPositionsAction.examples?.[0];
        if (firstExample) {
            expect(Array.isArray(firstExample)).toBe(true);
            expect(firstExample.length).toBeGreaterThan(0);
            // expect(firstExample[0]).toHaveProperty("user"); // Removed in v1
            expect(firstExample[0]).toHaveProperty("content");
        }
    });
});
