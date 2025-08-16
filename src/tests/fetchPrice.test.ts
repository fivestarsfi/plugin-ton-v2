import { describe, it, expect } from "bun:test";
import tokenPriceAction from "../actions/tokenPrice";

describe("Token Price Action", () => {
    it("should have correct metadata", () => {
        expect(tokenPriceAction.name).toBe("GET_TOKEN_PRICE_TON");
        expect(tokenPriceAction.description).toBe(
            "Fetches and returns token price information on TON blockchain"
        );
        expect(tokenPriceAction.similes).toContain("FETCH_TOKEN_PRICE_TON");
        expect(tokenPriceAction.similes).toContain("CHECK_TOKEN_PRICE_TON");
        expect(tokenPriceAction.similes).toContain("TOKEN_PRICE_TON");
    });

    it("should have validate function", () => {
        expect(typeof tokenPriceAction.validate).toBe("function");
    });

    it("should have handler function", () => {
        expect(typeof tokenPriceAction.handler).toBe("function");
    });

    it("should have examples", () => {
        expect(Array.isArray(tokenPriceAction.examples)).toBe(true);
        expect(tokenPriceAction.examples.length).toBeGreaterThan(0);

        // Check first example structure
        const firstExample = tokenPriceAction.examples[0];
        expect(Array.isArray(firstExample)).toBe(true);
        expect(firstExample.length).toBeGreaterThan(0);
        expect(firstExample[0]).toHaveProperty("name");
        expect(firstExample[0]).toHaveProperty("content");
    });

    it("should have correct template format", () => {
        const template = tokenPriceAction.template;
        expect(template).toContain("{{recentMessages}}");
        expect(template).toContain("```json");
    });
});

