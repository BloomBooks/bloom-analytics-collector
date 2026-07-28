import { describe, expect, it } from "vitest";
import { isReleaseTagForTest as isReleaseTag } from "./githubTags.js";

describe("which git tags count as releases", () => {
    it("accepts plain version tags, with or without the v", () => {
        expect(isReleaseTag("v3.4.5")).toBe(true);
        expect(isReleaseTag("3.4.5")).toBe(true);
        // Out-of-order build-style tags are still releases; only the date orders them.
        expect(isReleaseTag("v3.4.68")).toBe(true);
        expect(isReleaseTag("v3.3")).toBe(true);
    });

    it("excludes the pre-release tags in BloomReader's history", () => {
        expect(isReleaseTag("v3.2.14-beta")).toBe(false);
        expect(isReleaseTag("v3.2.8-beta")).toBe(false);
        expect(isReleaseTag("v4.0.0-alpha")).toBe(false);
        expect(isReleaseTag("v4.0.0-rc1")).toBe(false);
    });

    it("excludes anything that is not a version", () => {
        expect(isReleaseTag("latest")).toBe(false);
        expect(isReleaseTag("release")).toBe(false);
        expect(isReleaseTag("v")).toBe(false);
    });
});
