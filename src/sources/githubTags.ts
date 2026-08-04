import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Period, ReleaseField } from "../types.js";
import { compareVersions } from "../versions.js";
import { githubHeaders, stripTagPrefix } from "./github.js";

/**
 * Release info from git tags, for repos that tag releases but publish no GitHub
 * Releases. BloomBooks/BloomReader is one: it has 54 tags and zero releases, and
 * its tags line up with the Play Console release history (tag v3.4.5 dated
 * 2026-02-05 against a hand-recorded Play release of 3.4.5 on 2026-02-06 -- the
 * one-day gap being tag time versus publish time).
 *
 * The tag list is one request, but a tag's date requires fetching its commit, so
 * a repo with 50-odd tags would burn most of the unauthenticated hourly rate
 * limit on every run. Tag dates never change, so they are cached in a committed
 * file and only unknown tags are fetched.
 */
const cachePath = fileURLToPath(
    new URL("../../config/github-tag-dates.json", import.meta.url)
);

/** `owner/repo@tag` -> `YYYY-MM-DD`. */
type TagDateCache = Record<string, string>;

const loadCache = async (): Promise<TagDateCache> => {
    try {
        const parsed = JSON.parse(await readFile(cachePath, "utf8")) as Record<
            string,
            unknown
        >;
        const cache: TagDateCache = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (!key.startsWith("//") && typeof value === "string") {
                cache[key] = value;
            }
        }
        return cache;
    } catch {
        // No cache yet: the first run simply fetches everything.
        return {};
    }
};

const saveCache = async (cache: TagDateCache): Promise<void> => {
    const ordered = Object.fromEntries(
        Object.entries(cache).sort(([a], [b]) => a.localeCompare(b))
    );
    await writeFile(
        cachePath,
        JSON.stringify(
            {
                "//": "Cache of git tag -> commit date, keyed owner/repo@tag. Tag dates never change, so this is committed: it saves one GitHub API call per tag per run, which matters because the unauthenticated limit is 60/hour. Safe to delete; it will be rebuilt.",
                ...ordered,
            },
            null,
            4
        ) + "\n",
        "utf8"
    );
};

interface TagRef {
    name: string;
    commit: { url: string };
}

/**
 * Tags that represent a shipped release. The doc scopes Bloom Reader to the
 * release channel, and the repo's history includes `-beta` tags from an era when
 * betas were tagged too, so those are excluded.
 */
const isReleaseTag = (name: string): boolean =>
    /^v?\d+\.\d+(\.\d+)?$/.test(name);

export interface DatedTag {
    name: string;
    date: string;
}

/**
 * One tag listing per repo for the life of a run. Three dashboard columns
 * (version, date, count) come from the same tags, and without this each would
 * re-date every tag -- tripling a request count that already sits close to the
 * unauthenticated hourly limit.
 */
const tagListCache = new Map<string, Promise<DatedTag[]>>();

/** Every release tag in the repo with its commit date, newest last. */
export const listReleaseTags = (repo: string): Promise<DatedTag[]> => {
    const cached = tagListCache.get(repo);
    if (cached) return cached;
    const pending = fetchReleaseTags(repo);
    tagListCache.set(repo, pending);
    return pending;
};

const fetchReleaseTags = async (repo: string): Promise<DatedTag[]> => {
    const headers = githubHeaders();
    // Paginate: BloomReader already has 54 tags, and a single page silently
    // truncates at 100 -- which would drop the oldest releases from a count
    // without any error to notice.
    const tags: TagRef[] = [];
    for (let page = 1; page <= 20; page++) {
        const response = await fetch(
            `https://api.github.com/repos/${repo}/tags?per_page=100&page=${page}`,
            { headers }
        );
        if (!response.ok) {
            throw new Error(
                `GitHub tags for ${repo} returned ${response.status}: ${(await response.text()).slice(0, 200)}`
            );
        }
        const batch = (await response.json()) as TagRef[];
        tags.push(...batch);
        if (batch.length < 100) break;
    }
    const releaseTags = tags.filter((tag) => isReleaseTag(tag.name));

    const cache = await loadCache();
    let added = 0;
    const dated: DatedTag[] = [];
    try {
        for (const tag of releaseTags) {
            const key = `${repo}@${tag.name}`;
            let date = cache[key];
            if (!date) {
                const commitResponse = await fetch(tag.commit.url, { headers });
                if (!commitResponse.ok) {
                    throw new Error(
                        `Could not date tag ${tag.name} of ${repo}: HTTP ${commitResponse.status}. Dating a tag costs one request, and the unauthenticated limit is 60/hour -- set GITHUB_TOKEN, or re-run later to carry on from the tags already cached.`
                    );
                }
                const commit = (await commitResponse.json()) as {
                    commit?: {
                        committer?: { date?: string };
                        author?: { date?: string };
                    };
                };
                const raw =
                    commit.commit?.committer?.date ??
                    commit.commit?.author?.date;
                if (!raw) {
                    throw new Error(
                        `Tag ${tag.name} of ${repo} has no commit date.`
                    );
                }
                date = raw.slice(0, 10);
                cache[key] = date;
                added++;
            }
            dated.push({ name: tag.name, date });
        }
    } finally {
        // Persist whatever was dated even if we ran out of rate limit part way,
        // so a re-run resumes instead of starting over.
        if (added > 0) await saveCache(cache);
    }

    // Tag names do not sort meaningfully as strings (v3.4.68 postdates v3.4.8), so
    // order by date. But two tags can share a date -- v3.4.7 and v3.4.8 are both
    // dated 2026-07-10 -- and the date alone then cannot say which is the later
    // release, which left the quarter reporting the older of the two.
    return dated.sort(
        (a, b) =>
            a.date.localeCompare(b.date) ||
            compareVersions(stripTagPrefix(a.name), stripTagPrefix(b.name))
    );
};

/** The count, latest version, or latest date of release tags in the period. */
export const getTagReleaseField = async (
    repo: string,
    want: ReleaseField,
    period: Period
): Promise<{ value: string | number | null; provenance: string }> => {
    const all = await listReleaseTags(repo);
    const inPeriod = all.filter(
        (tag) => tag.date >= period.from && tag.date <= period.to
    );

    if (want === "count") {
        return {
            value: inPeriod.length,
            provenance: `git tags on ${repo} in ${period.from}..${period.to}: ${inPeriod.map((t) => `${t.name} (${t.date})`).join(", ") || "none"}`,
        };
    }
    if (inPeriod.length === 0) {
        return {
            value: null,
            provenance: `git tags on ${repo}: none in ${period.from}..${period.to}`,
        };
    }
    const latest = inPeriod[inPeriod.length - 1]!;
    return {
        value: want === "version" ? stripTagPrefix(latest.name) : latest.date,
        provenance: `git tag ${latest.name} on ${repo}, dated ${latest.date} (tag date; Play's publish date can be a day later)`,
    };
};

/** Exposed for unit tests only. */
export const isReleaseTagForTest = isReleaseTag;
