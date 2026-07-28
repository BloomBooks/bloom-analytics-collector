import { describe, expect, it } from "vitest";
import { stripTagPrefix } from "./github.js";

describe("release tag to dashboard version", () => {
    it("drops the conventional v prefix", () => {
        expect(stripTagPrefix("v2.1.16")).toBe("2.1.16");
        expect(stripTagPrefix("v2.2.0")).toBe("2.2.0");
    });

    it("leaves a bare version alone", () => {
        expect(stripTagPrefix("2.1.16")).toBe("2.1.16");
    });

    it("does not strip a v that starts a word rather than a version", () => {
        expect(stripTagPrefix("version-2")).toBe("version-2");
        expect(stripTagPrefix("vnext")).toBe("vnext");
    });
});
