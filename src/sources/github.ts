import type { Period, ReleaseField } from "../types.js";

interface GitHubRelease {
    tag_name: string;
    name: string | null;
    draft: boolean;
    prerelease: boolean;
    published_at: string | null;
}

/**
 * Standard GitHub API headers. A token is optional for public repos but raises
 * the rate limit from 60/hr to 5000/hr, which matters when dating tags: that
 * costs one request per tag.
 */
export const githubHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };
    if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    return headers;
};

/**
 * One listing per repo for the life of a run. Three dashboard columns (version,
 * date, count) come from the same releases, so without this each would paginate
 * the whole list again -- three times the requests against an unauthenticated
 * limit of 60 an hour. The same reasoning as the tag cache in githubTags.ts.
 */
const releaseListCache = new Map<string, Promise<GitHubRelease[]>>();

/** Fetches all releases for a repo, following pagination, once per run. */
const fetchReleases = (repo: string): Promise<GitHubRelease[]> => {
    const cached = releaseListCache.get(repo);
    if (cached) return cached;
    const pending = fetchAllReleasePages(repo);
    releaseListCache.set(repo, pending);
    return pending;
};

const fetchAllReleasePages = async (
    repo: string
): Promise<GitHubRelease[]> => {
    const headers = githubHeaders();

    const releases: GitHubRelease[] = [];
    for (let page = 1; ; page++) {
        const response = await fetch(
            `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`,
            { headers }
        );
        if (!response.ok) {
            throw new Error(
                `GitHub releases for ${repo} returned ${response.status}: ${await response.text()}`
            );
        }
        const batch = (await response.json()) as GitHubRelease[];
        releases.push(...batch);
        if (batch.length < 100) break;
    }
    return releases;
};

/** Published, non-draft, non-prerelease releases whose date falls in the period. */
const releasesInPeriod = (
    releases: GitHubRelease[],
    period: Period
): GitHubRelease[] =>
    releases.filter((release) => {
        if (release.draft || release.prerelease || !release.published_at) {
            return false;
        }
        const date = release.published_at.slice(0, 10);
        return date >= period.from && date <= period.to;
    });

/**
 * The count, latest version, or latest date of releases in the period -- the
 * dashboard keeps version and date in separate columns.
 */
export const getGitHubReleaseField = async (
    repo: string,
    want: ReleaseField,
    period: Period
): Promise<{ value: string | number | null; provenance: string }> => {
    const inPeriod = releasesInPeriod(await fetchReleases(repo), period);

    if (want === "count") {
        return {
            value: inPeriod.length,
            provenance: `GitHub ${repo} releases in ${period.from}..${period.to}: ${inPeriod.map((r) => r.tag_name).join(", ") || "none"}`,
        };
    }
    if (inPeriod.length === 0) {
        return {
            value: null,
            provenance: `GitHub ${repo}: no releases in ${period.from}..${period.to}`,
        };
    }
    // The API returns newest first, but do not rely on that.
    inPeriod.sort((a, b) =>
        (a.published_at ?? "").localeCompare(b.published_at ?? "")
    );
    const latest = inPeriod[inPeriod.length - 1]!;
    return {
        value:
            want === "version"
                ? stripTagPrefix(latest.tag_name)
                : latest.published_at!.slice(0, 10),
        provenance: `GitHub ${repo} latest release in period (tag ${latest.tag_name})`,
    };
};

/**
 * Drops the conventional "v" from a release tag: the dashboard records bare
 * version numbers ("2.1.16"), not tag names ("v2.1.16").
 */
export const stripTagPrefix = (tag: string): string =>
    /^v\d/.test(tag) ? tag.slice(1) : tag;
