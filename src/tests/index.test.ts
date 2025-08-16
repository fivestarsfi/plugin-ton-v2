import { describe, it, expect } from "bun:test";
import tonPlugin from "../index";

describe("TON Plugin", () => {
    it("should export a valid plugin object", () => {
        expect(tonPlugin).toBeDefined();
        expect(tonPlugin.name).toBe("ton");
        expect(tonPlugin.description).toBe("Ton Plugin for Eliza");
    });

    it("should export actions array", () => {
        expect(tonPlugin.actions).toBeDefined();
        if (tonPlugin.actions) {
            expect(Array.isArray(tonPlugin.actions)).toBe(true);
            expect(tonPlugin.actions.length).toBeGreaterThan(0);
        }
    });

    it("should not have services in v1", () => {
        // Services are removed in v1 migration
        expect(tonPlugin.services).toBeUndefined();
    });

    it("should export providers array", () => {
        expect(tonPlugin.providers).toBeDefined();
        if (tonPlugin.providers) {
            expect(Array.isArray(tonPlugin.providers)).toBe(true);
            expect(tonPlugin.providers.length).toBeGreaterThan(0);
        }
    });

    it("should have all required action names", () => {
        const actionNames =
            tonPlugin.actions?.map((action: any) => action.name) || [];
        const expectedActions = [
            "SEND_TON_TOKEN",
            "CREATE_TON_WALLET",
            "EVAA_BORROW",
            "EVAA_SUPPLY",
            "EVAA_WITHDRAW",
            "EVAA_REPAY",
            "EVAA_POSITIONS",
            "SWAP_TOKEN_STON",
            "QUERY_STON_ASSET",
            "TRANSFER_NFT",
            "MINT_NFT",
            "UPDATE_NFT_METADATA",
            "MANAGE_LIQUIDITY_POOLS",
            "INTERACT_JETTON",
        ];

        for (const expectedAction of expectedActions) {
            expect(actionNames).toContain(expectedAction);
        }
    });
});
