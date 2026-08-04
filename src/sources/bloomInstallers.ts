import type { Period, ReleaseField } from "../types.js";
import { compareVersions } from "../versions.js";

/**
 * Bloom Editor installers are published to a public S3 bucket, which is also
 * what feeds the bloomlibrary.org "all Bloom installers" page that the manual
 * process counts. Listing the bucket gives us both the version and a date, so we
 * can count releases in a period without TeamCity credentials.
 */
const BUCKET_LIST_URL = "https://s3.amazonaws.com/bloomlibrary.org";
const PREFIX = "installers/";

export interface InstallerEntry {
    version: string;
    /** S3 LastModified, `YYYY-MM-DD`. A proxy for the release date. */
    date: string;
    key: string;
}

/**
 * Recognises a Release-channel Bloom installer and pulls out its version.
 * Returns null for anything we should not count.
 *
 * The bucket has accumulated several naming conventions:
 *   BloomInstaller.6.1.11.exe          modern (2019-)
 *   BloomInstaller.6.3.0.x64.exe       modern, architecture-suffixed (6.3-)
 *   BloomInstaller.3.0.100.Release.msi legacy, channel in the name
 *   BloomInstaller.2.0.2000.msi        earliest, before channels existed
 * and these, which must NOT be counted as releases:
 *   BloomInstaller.*.Beta.msi / .beta.msi / .alpha.msi / .ACR.msi
 *   Reading-App-Builder-For-Bloom-6-4-Setup.exe   (a different product)
 *   installers/old/... , installers/linux/...     (archives, other platforms)
 */
export const parseInstallerKey = (
    key: string,
    date: string
): InstallerEntry | null => {
    if (!key.startsWith(PREFIX)) return null;
    const name = key.slice(PREFIX.length);
    // Anything in a subfolder (old/, linux/) is not a current release artifact.
    if (name.includes("/") || name.length === 0) return null;

    const match =
        /^BloomInstaller\.(\d+\.\d+\.\d+)\.*(?:x\d+\.)?(Release\.)?(exe|msi)$/i.exec(
            name
        );
    if (!match) return null;
    return { version: match[1]!, date, key };
};

/** One page of an S3 bucket listing. */
interface ListPage {
    entries: { key: string; date: string }[];
    truncated: boolean;
}

const fetchPage = async (marker: string): Promise<ListPage> => {
    const url = `${BUCKET_LIST_URL}?prefix=${encodeURIComponent(PREFIX)}&max-keys=1000&marker=${encodeURIComponent(marker)}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(
            `S3 listing of ${PREFIX} returned ${response.status}: ${await response.text()}`
        );
    }
    const xml = await response.text();
    const entries = [
        ...xml.matchAll(
            /<Key>([^<]+)<\/Key><LastModified>([^<]+)<\/LastModified>/g
        ),
    ].map((m) => ({ key: m[1]!, date: m[2]!.slice(0, 10) }));
    return {
        entries,
        truncated: /<IsTruncated>true<\/IsTruncated>/.test(xml),
    };
};

/**
 * One listing for the life of a run. Bloom Editor's three release columns
 * (version, date, count) all come from the same bucket listing, which is several
 * hundred keys over multiple pages -- so without this it was fetched three times.
 * The same reasoning as the caches in github.ts and githubTags.ts.
 */
let installerListing: Promise<InstallerEntry[]> | undefined;

/**
 * Lists every Release-channel installer in the bucket, newest last. Deduplicated
 * by version, since one release can publish several artifacts (e.g. an x64 and
 * an x86 build) and that is still one release.
 */
export const listBloomInstallers = (): Promise<InstallerEntry[]> => {
    installerListing ??= fetchBloomInstallers();
    return installerListing;
};

const fetchBloomInstallers = async (): Promise<InstallerEntry[]> => {
    const byVersion = new Map<string, InstallerEntry>();
    let marker = "";
    // The bucket holds a few hundred keys; the cap is a runaway-loop backstop.
    for (let page = 0; page < 20; page++) {
        const { entries, truncated } = await fetchPage(marker);
        if (entries.length === 0) break;
        for (const entry of entries) {
            const installer = parseInstallerKey(entry.key, entry.date);
            if (!installer) continue;
            const existing = byVersion.get(installer.version);
            // Keep the earliest date for a version: that is when it shipped.
            if (!existing || installer.date < existing.date) {
                byVersion.set(installer.version, installer);
            }
        }
        if (!truncated) break;
        marker = entries[entries.length - 1]!.key;
    }
    // Date first, then version: sorting on the date alone would leave same-day
    // releases in bucket-listing order, which is alphabetical and therefore puts
    // 6.2.10 before 6.2.9.
    return [...byVersion.values()].sort(
        (a, b) =>
            a.date.localeCompare(b.date) ||
            compareVersions(a.version, b.version)
    );
};

/** Release-channel installers published within the period. */
export const bloomInstallersInPeriod = async (
    period: Period
): Promise<InstallerEntry[]> => {
    const all = await listBloomInstallers();
    if (all.length === 0) {
        throw new Error(
            "The installers bucket listing yielded no recognisable installers; the naming convention has probably changed."
        );
    }
    return all.filter(
        (entry) => entry.date >= period.from && entry.date <= period.to
    );
};

/**
 * The count, latest version, or latest date of Bloom Editor releases in the
 * period -- the dashboard keeps version and date in separate columns.
 */
export const getBloomReleaseField = async (
    want: ReleaseField,
    period: Period
): Promise<{ value: string | number | null; provenance: string }> => {
    const inPeriod = await bloomInstallersInPeriod(period);
    const source = "s3://bloomlibrary.org/installers";

    if (want === "count") {
        return {
            value: inPeriod.length,
            provenance: `${source} Release-channel versions in ${period.from}..${period.to}: ${inPeriod.map((e) => `${e.version} (${e.date})`).join(", ") || "none"}`,
        };
    }
    if (inPeriod.length === 0) {
        return {
            value: null,
            provenance: `${source}: no releases in ${period.from}..${period.to}`,
        };
    }
    const latest = inPeriod[inPeriod.length - 1]!;
    return {
        value: want === "version" ? latest.version : latest.date,
        provenance: `${source}, from key ${latest.key}`,
    };
};

