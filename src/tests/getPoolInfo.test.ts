import { describe, it, expect } from "bun:test";
import getPoolInfoAction from "../actions/getPoolInfo";

describe("Get Pool Info Action", () => {
    it("should have correct metadata", () => {
        expect(getPoolInfoAction.name).toBe("GET_POOL_INFO");
        expect(getPoolInfoAction.description).toBe(
            "Fetch detailed global staking pool information. Only perform if user is asking for a specific Pool Info, and NOT your stake."
        );
        expect(getPoolInfoAction.similes).toContain("FETCH_POOL_INFO");
        expect(getPoolInfoAction.similes).toContain("POOL_DATA");
        expect(getPoolInfoAction.similes).toContain("GET_STAKING_INFO");
    });

    it("should have validate function", () => {
        expect(typeof getPoolInfoAction.validate).toBe("function");
    });

    it("should have handler function", () => {
        expect(typeof getPoolInfoAction.handler).toBe("function");
    });

    it("should have examples", () => {
        expect(Array.isArray(getPoolInfoAction.examples)).toBe(true);
        expect(getPoolInfoAction.examples.length).toBeGreaterThan(0);

        // Check first example structure
        const firstExample = getPoolInfoAction.examples[0];
        expect(Array.isArray(firstExample)).toBe(true);
        expect(firstExample.length).toBeGreaterThan(0);
        expect(firstExample[0]).toHaveProperty("user");
        expect(firstExample[0]).toHaveProperty("content");
    });

    it("should have correct template format", () => {
        const template = getPoolInfoAction.template;
        expect(template).toContain("{{recentMessages}}");
        expect(template).toContain("<values>");
        expect(template).toContain("</values>");
    });
});

