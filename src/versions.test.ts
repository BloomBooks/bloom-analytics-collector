import { describe, expect, it } from "vitest";
import { compareVersions } from "./versions.js";

describe("ordering releases that share a date", () => {
    it("puts the later version last, not the alphabetically later one", () => {
        // Live cases, not hypothetical: Bloom Editor 6.2.1 and 6.2.2 both shipped
        // 2026-02-19, Bloom Reader v3.4.7 and v3.4.8 are both dated 2026-07-10, and
        // 6.2.9 vs 6.2.10 is where a string comparison inverts.
        expect(compareVersions("6.2.10", "6.2.9")).toBeGreaterThan(0);
        expect(compareVersions("6.2.2", "6.2.1")).toBeGreaterThan(0);
        expect(compareVersions("3.4.8", "3.4.7")).toBeGreaterThan(0);
        expect(compareVersions("6.3.0", "6.2.99")).toBeGreaterThan(0);
        expect(compareVersions("6.2.1", "6.2.1")).toBe(0);
    });

    it("copes with versions of differing length", () => {
        expect(compareVersions("6.3", "6.3.1")).toBeLessThan(0);
        expect(compareVersions("6.3.0", "6.3")).toBe(0);
    });

    it("is a usable sort comparator, which is the only way it gets called", () => {
        const sorted = ["3.4.8", "3.4.10", "3.4.7", "3.4.68"].sort(
            compareVersions
        );
        expect(sorted).toEqual(["3.4.7", "3.4.8", "3.4.10", "3.4.68"]);
    });
});
