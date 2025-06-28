import { describe, it, expect } from "bun:test";
import loadWalletAction from "../actions/loadWallet";

describe("Load Wallet Action", () => {
    it("should have correct metadata", () => {
        expect(loadWalletAction.name).toBe("RECOVER_TON_WALLET");
        expect(loadWalletAction.description).toBe(
            "Loads an existing TON wallet from an encrypted backup file using the provided password."
        );
        expect(loadWalletAction.similes).toContain("IMPORT_TON_WALLET");
        expect(loadWalletAction.similes).toContain("RECOVER_WALLET");
    });

    it("should have validate function", () => {
        expect(typeof loadWalletAction.validate).toBe("function");
    });

    it("should have handler function", () => {
        expect(typeof loadWalletAction.handler).toBe("function");
    });

    it("should have examples", () => {
        expect(Array.isArray(loadWalletAction.examples)).toBe(true);
        expect(loadWalletAction.examples.length).toBeGreaterThan(0);

        // Check first example structure
        const firstExample = loadWalletAction.examples[0];
        expect(Array.isArray(firstExample)).toBe(true);
        expect(firstExample.length).toBeGreaterThan(0);
        expect(firstExample[0]).toHaveProperty("user");
        expect(firstExample[0]).toHaveProperty("content");
    });
});
