import { describe, it, expect } from "bun:test";
import auctionInteractionAction from "../actions/auctionInteraction";

describe("Auction Interaction Action", () => {
    it("should have correct metadata", () => {
        expect(auctionInteractionAction.name).toBe("INTERACT_AUCTION");
        expect(auctionInteractionAction.description).toBe(
            "Interacts with an auction contract. Supports actions: getSaleData, bid, stop, and cancel."
        );
        expect(auctionInteractionAction.similes).toContain("AUCTION_INTERACT");
        expect(auctionInteractionAction.similes).toContain("AUCTION_ACTION");
    });

    it("should have validate function", () => {
        expect(typeof auctionInteractionAction.validate).toBe("function");
    });

    it("should have handler function", () => {
        expect(typeof auctionInteractionAction.handler).toBe("function");
    });

    it("should have examples", () => {
        expect(Array.isArray(auctionInteractionAction.examples)).toBe(true);
        expect(auctionInteractionAction.examples.length).toBeGreaterThan(0);

        // Check first example structure
        const firstExample = auctionInteractionAction.examples[0];
        expect(Array.isArray(firstExample)).toBe(true);
        expect(firstExample.length).toBeGreaterThan(0);
        expect(firstExample[0]).toHaveProperty("user");
        expect(firstExample[0]).toHaveProperty("content");
    });

    it("should have correct template format", () => {
        const template = auctionInteractionAction.template;
        expect(template).toContain("{{recentMessages}}");
        expect(template).toContain("<values>");
        expect(template).toContain("</values>");
    });
});
