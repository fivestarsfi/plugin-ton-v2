import { describe, it, expect } from "bun:test";
import { tonTokenPriceProvider } from "../../providers/tokenProvider";

describe("Token Price Provider", () => {
    it("should have correct name and description", () => {
        expect(tonTokenPriceProvider.name).toBe("tonTokenPriceProvider");
        expect(tonTokenPriceProvider.description).toBe(
            "Provides real-time TON token and pair price information"
        );
    });

    it("should extract token from text correctly", () => {
        const testCases = [
            { input: "What is the price of TON?", expected: "TON" },
            { input: "Check the value of NOT token", expected: "NOT" },
            { input: "What is the price of DOGS?", expected: "DOGS" },
        ];

        for (const testCase of testCases) {
            // Use private method via any cast for testing
            const result = (tonTokenPriceProvider as any).extractToken(
                testCase.input
            );
            expect(result).toBe(testCase.expected);
        }
    });

    it("should extract pair from text correctly", () => {
        const testCases = [
            { input: "What is the price of TON/USDT?", expected: "TON/USDT" },
            { input: "Check the value of NOT/TON pair", expected: "NOT/TON" },
        ];

        for (const testCase of testCases) {
            // Use private method via any cast for testing
            const result = (tonTokenPriceProvider as any).extractPair(
                testCase.input
            );
            expect(result).toBe(testCase.expected);
        }
    });

    it("should normalize token names correctly", () => {
        const testCases = [
            { input: "notcoin", expected: "NOT" },
            { input: "toncoin", expected: "TON" },
            { input: "dedust", expected: "DDST" },
            { input: "random", expected: "RANDOM" },
        ];

        for (const testCase of testCases) {
            // Use private method via any cast for testing
            const result = (tonTokenPriceProvider as any).normalizeToken(
                testCase.input
            );
            expect(result).toBe(testCase.expected);
        }
    });

    it("should format token price data correctly", () => {
        const mockData = {
            rates: {
                EQTest123: {
                    prices: { USD: 2.123456 },
                    diff_24h: { USD: "+5.23" },
                    diff_7d: { USD: "-2.10" },
                    diff_30d: { USD: "+15.55" },
                },
            },
        };

        const result = tonTokenPriceProvider.formatTokenPriceData(
            "TON",
            "EQTest123",
            mockData
        );
        expect(result).toContain("Current price: $2.123456 USD");
        expect(result).toContain("24h change: +5.23");
        expect(result).toContain("7d change: -2.10");
        expect(result).toContain("30d change: +15.55");
    });
});
