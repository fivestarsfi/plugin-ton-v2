import { describe, it, expect } from "bun:test";
import {
    swapStonAction,
    finishSwapStonAction,
    getPendingStonSwapDetailsAction,
} from "../actions/swapSton";

describe("Swap Ston Actions", () => {
    describe("Swap Token Ston Action", () => {
        it("should have correct metadata", () => {
            expect(swapStonAction.name).toBe("SWAP_TOKEN_STON");
            expect(swapStonAction.description).toContain(
                "Start a swap of tokens in TON blockchain through STON.fi DEX"
            );
            expect(swapStonAction.similes).toContain("SWAP_TOKENS_STON");
        });

        it("should have validate function", () => {
            expect(typeof swapStonAction.validate).toBe("function");
        });

        it("should have handler function", () => {
            expect(typeof swapStonAction.handler).toBe("function");
        });

        it("should have examples", () => {
            expect(Array.isArray(swapStonAction.examples)).toBe(true);
            expect(swapStonAction.examples?.length).toBeGreaterThan(0);

            // Check first example structure
            const firstExample = swapStonAction.examples?.[0];
            if (firstExample) {
                expect(Array.isArray(firstExample)).toBe(true);
                expect(firstExample.length).toBeGreaterThan(0);
                // expect(firstExample[0]).toHaveProperty("user"); // Removed in v1
                expect(firstExample[0]).toHaveProperty("content");
            }
        });
    });

    describe("Finish Swap Token Ston Action", () => {
        it("should have correct metadata", () => {
            expect(finishSwapStonAction.name).toBe("FINISH_SWAP_TOKEN_STON");
            expect(finishSwapStonAction.description).toContain(
                "Finish a pending swap of tokens in TON blockchain through STON.fi DEX"
            );
            expect(finishSwapStonAction.similes).toContain(
                "FINISH_SWAP_TOKENS_STON"
            );
        });

        it("should have validate function", () => {
            expect(typeof finishSwapStonAction.validate).toBe("function");
        });

        it("should have handler function", () => {
            expect(typeof finishSwapStonAction.handler).toBe("function");
        });

        it("should have examples", () => {
            expect(Array.isArray(finishSwapStonAction.examples)).toBe(true);
            expect(finishSwapStonAction.examples?.length).toBeGreaterThan(0);

            // Check first example structure
            const firstExample = finishSwapStonAction.examples?.[0];
            if (firstExample) {
                expect(Array.isArray(firstExample)).toBe(true);
                expect(firstExample.length).toBeGreaterThan(0);
                // expect(firstExample[0]).toHaveProperty("user"); // Removed in v1
                expect(firstExample[0]).toHaveProperty("content");
            }
        });
    });

    describe("Get Pending Ston Swap Details Action", () => {
        it("should have correct metadata", () => {
            expect(getPendingStonSwapDetailsAction.name).toBe(
                "GET_PENDING_STON_SWAP_DETAILS"
            );
            expect(getPendingStonSwapDetailsAction.description).toContain(
                "Get the details of the pending swap of tokens in TON blockchain through STON.fi DEX"
            );
        });

        it("should have validate function", () => {
            expect(typeof getPendingStonSwapDetailsAction.validate).toBe(
                "function"
            );
        });

        it("should have handler function", () => {
            expect(typeof getPendingStonSwapDetailsAction.handler).toBe(
                "function"
            );
        });

        it("should have examples", () => {
            expect(
                Array.isArray(getPendingStonSwapDetailsAction.examples)
            ).toBe(true);
            expect(
                getPendingStonSwapDetailsAction.examples?.length
            ).toBeGreaterThan(0);

            // Check first example structure
            const firstExample = getPendingStonSwapDetailsAction.examples?.[0];
            if (firstExample) {
                expect(Array.isArray(firstExample)).toBe(true);
                expect(firstExample.length).toBeGreaterThan(0);
                // expect(firstExample[0]).toHaveProperty("user"); // Removed in v1
                expect(firstExample[0]).toHaveProperty("content");
            }
        });
    });
});
