import { describe, expect, it } from "vitest";
import { sanitizeForOutput } from "./sanitize.js";

/**
 * Shaped exactly like the Google Cloud Storage denial that leaked into a
 * committed report, but with invented identifiers. The real ones are what this
 * module exists to remove, so putting them in a fixture would defeat it.
 */
const GCS_DENIAL =
    "reports-reader@example-project.iam.gserviceaccount.com does not have " +
    "storage.objects.get access to the Google Cloud Storage object. Permission " +
    "'storage.objects.get' denied on resource " +
    "'//storage.googleapis.com/projects/_/buckets/pubsite_prod_rev_11112222333344445555/" +
    "objects/stats/installs/installs_org.example.app_202604_overview.csv' (or it may " +
    "not exist). Remediate access with this Troubleshooter URL or share it with your " +
    "administrator - https://console.cloud.google.com/iam-admin/troubleshooter/summary" +
    ";errorId=AbCdEf123456";

describe("sanitizeForOutput", () => {
    it("removes every identifier from a GCS denial, keeping the diagnosis", () => {
        // Sanity check: the fixture really does contain what we expect removed.
        expect(GCS_DENIAL).toContain("gserviceaccount.com");
        expect(GCS_DENIAL).toContain("pubsite_prod_rev_");
        expect(GCS_DENIAL).toContain("console.cloud.google.com");

        const actual = sanitizeForOutput(GCS_DENIAL);

        expect(actual).not.toContain("reports-reader");
        expect(actual).not.toContain("example-project");
        expect(actual).not.toContain("gserviceaccount.com");
        expect(actual).not.toContain("11112222333344445555");
        expect(actual).not.toContain("console.cloud.google.com");
        // The part that tells an operator what went wrong survives.
        expect(actual).toContain("does not have storage.objects.get access");
        expect(actual).toContain("installs_org.example.app_202604_overview.csv");
    });

    it("keeps a bucket object path but not the bucket name", () => {
        expect(
            sanitizeForOutput(
                "gs://pubsite_prod_rev_11112222333344445555/stats/installs/installs_x_202604_overview.csv"
            )
        ).toBe("gs://<bucket>/stats/installs/installs_x_202604_overview.csv");
    });

    it("reduces an absolute path to its file name, on either platform", () => {
        expect(
            sanitizeForOutput(
                "read C:\\Users\\Someone\\Downloads\\installs_202604.csv"
            )
        ).toBe("read installs_202604.csv");
        expect(
            sanitizeForOutput("read /home/someone/secret/installs_202604.csv")
        ).toBe("read installs_202604.csv");
    });

    it("leaves ordinary provenance untouched", () => {
        const clean =
            "Mixpanel raw export, bloomReaderRelease [all], mau-1; 493669 events scanned";
        expect(sanitizeForOutput(clean)).toBe(clean);
        const tags =
            "git tags on BloomBooks/BloomReader in 2026-01-01..2026-03-31: v3.4.5 (2026-02-05)";
        expect(sanitizeForOutput(tags)).toBe(tags);
    });

    it("does not mistake a package name or a version for a path", () => {
        expect(sanitizeForOutput("org.sil.bloom.reader 3.4.5")).toBe(
            "org.sil.bloom.reader 3.4.5"
        );
    });

    it("does not let a held-back marker survive into the output", () => {
        const two =
            "first gs://a-bucket/x/y.csv then gs://b-bucket/p/q.csv done";
        const actual = sanitizeForOutput(two);
        expect(actual).toBe(
            "first gs://<bucket>/x/y.csv then gs://<bucket>/p/q.csv done"
        );
        expect(actual).not.toContain("__GCS");
    });
});
