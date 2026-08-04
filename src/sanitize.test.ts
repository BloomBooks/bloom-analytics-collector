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

    it("reduces a path even when a folder name contains a space", () => {
        // This is the one that leaked. The directory part of the pattern excluded
        // whitespace, so matching stopped at the space and the account name -- a
        // person's name -- was the only thing left besides the file name, in text
        // that gets committed to a public repo.
        expect(
            sanitizeForOutput(
                'failed to read "C:\\Users\\Jane Smith\\keys\\service-account.json"'
            )
        ).toBe('failed to read "service-account.json"');
        expect(
            sanitizeForOutput("at /home/jane doe/secrets/key.json")
        ).toBe("at key.json");
        expect(
            sanitizeForOutput("D:\\Program Files\\Bloom\\installs.csv")
        ).toBe("installs.csv");
        // Sanity check that these inputs really do contain the name beforehand,
        // so a pattern that silently stopped matching could not pass this test.
        expect("C:\\Users\\Jane Smith\\keys\\x.json").toContain("Jane Smith");
    });

    it("reduces a path however the platform chose to spell it", () => {
        // Windows takes either separator, and Node hands back forward slashes for
        // anything that came through a module path -- so "C:/Users/Jane Smith/..."
        // is a shape that really occurs. It was passing through wholly untouched,
        // which is worse than the half-redaction above.
        expect(
            sanitizeForOutput("C:/Users/Jane Smith/keys/service-account.json")
        ).toBe("service-account.json");
        // file:// locations, which Node uses for module errors. The rule's own "//"
        // put a slash in front of the path, and the path rule then declined it.
        expect(
            sanitizeForOutput("file:///C:/Users/Jane Smith/keys/key.json")
        ).toBe("key.json");
        expect(sanitizeForOutput("file:///home/jane doe/keys/key.json")).toBe(
            "key.json"
        );
    });

    it("stops at the end of a path instead of running on through the sentence", () => {
        // Allowing spaces inside a folder name risks the opposite failure: a match
        // that swallows the prose after the path and joins up with the next one.
        expect(
            sanitizeForOutput(
                "read C:\\tmp\\a.csv and then read /var/log/b.csv"
            )
        ).toBe("read a.csv and then read b.csv");
        expect(
            sanitizeForOutput("copied /home/jane doe/a.csv to /tmp/b.csv ok")
        ).toBe("copied a.csv to b.csv ok");
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

    it("replaces a URL wholesale, rather than leaving a mangled remnant", () => {
        // Regression: the path rule used to run first and reduce this to
        // "https:summary" -- the host was gone, but only by accident.
        expect(
            sanitizeForOutput(
                "see https://console.cloud.google.com/iam-admin/troubleshooter/summary for help"
            )
        ).toBe("see <url> for help");
        expect(sanitizeForOutput("plain https://example.com here")).toBe(
            "plain <url> here"
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

describe("URI-shaped provenance", () => {
    it("leaves an s3 bucket URI intact", () => {
        // Regression: the path rule treated the URI's own slashes as a filesystem
        // path and reduced this to "s3:installers", naming a bucket that does not
        // exist -- and it reached the committed reports before being caught.
        expect(
            sanitizeForOutput(
                "s3://bloomlibrary.org/installers, from key installers/BloomInstaller.6.3.2.x64.exe"
            )
        ).toBe(
            "s3://bloomlibrary.org/installers, from key installers/BloomInstaller.6.3.2.x64.exe"
        );
    });

    it("still reduces a genuine local path", () => {
        expect(sanitizeForOutput("read /home/someone/x/installs.csv")).toBe(
            "read installs.csv"
        );
        expect(
            sanitizeForOutput("read C:\\Users\\Someone\\installs.csv")
        ).toBe("read installs.csv");
    });
});
