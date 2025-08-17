import { describe, it, expect } from "bun:test";

describe("Simple test", () => {
    it("should pass", () => {
        expect(1 + 1).toBe(2);
    });

    it("should work with async", async () => {
        const result = await Promise.resolve(42);
        expect(result).toBe(42);
    });
});
