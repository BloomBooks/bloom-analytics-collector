import { monthsInPeriod } from "../period.js";
import type { ExportMeasure, MixpanelProjectKey, Period } from "../types.js";
import { mixpanelAuthHeader, mixpanelProjectId } from "./mixpanelAuth.js";

/**
 * Computes the Mixpanel-sourced metrics from the RAW EVENT EXPORT rather than
 * from saved Insights reports.
 *
 * Why: our Mixpanel plan rejects every aggregate query endpoint with HTTP 402
 * ("Your plan does not allow API calls") -- segmentation, insights, JQL,
 * retention, events, all of them. The raw export at data.mixpanel.com is not
 * metered, so it is the only programmatic route to these numbers.
 *
 * The cost is that the metric definitions now live in this file instead of in
 * the team's saved reports, so they can drift from what the Mixpanel UI shows.
 * In particular Mixpanel's "unique users" is computed after identity merging,
 * which the raw export does not reflect, so user counts here may differ
 * slightly from the UI. Validate against a hand-collected quarter before
 * trusting them.
 */

/**
 * A named subset of a project's traffic, defined by the `host` property. One
 * Mixpanel project carries several products; `host` is what separates them.
 *
 * `undefined` is a real, meaningful value here, not an absence: roughly half of
 * bloomlibrary.org's events carry no `host` at all (older client versions), which
 * is what the collection doc means by the "undefined/bloomlibrary.org bucket".
 */
export interface Bucket {
    name: string;
    /** `host` values in this bucket. `null` matches events with no host. */
    hosts: (string | null)[];
}

export const BUCKETS: Record<string, Bucket> = {
    "bloomlibrary.org": {
        name: "bloomlibrary.org",
        hosts: [null, "bloomlibrary"],
    },
    bloompubviewer: { name: "bloompubviewer", hosts: ["bloompubviewer"] },
    /**
     * Everything, for projects that carry only one product. The Bloom Editor and
     * Bloom Reader projects use this: Bloom Editor sets no host at all, and Bloom
     * Reader's absent/"bloomreader" split is still all Bloom Reader.
     *
     * (The BloomLibrary project also carries a "readerapp" host. It has no
     * dashboard column, so it is deliberately not a bucket.)
     */
    all: { name: "all", hosts: [] },
};

/**
 * Events we track per-user, for metrics that count "users who did X" rather than
 * all active users. Kept to a whitelist because a Set of users per event name
 * would otherwise be unbounded.
 *
 * "Created" is emitted by the DesktopAnalytics library on a user's first launch
 * on a system (see Analytics.cs -- the name is Segment's convention for what the
 * comment there calls "FirstLaunchOnSystem"), so unique users with a Created
 * event is Bloom Editor's install count.
 */
const FIRST_LAUNCH_EVENT = "Created";

/** What one bucket's events add up to over the period. */
export interface BucketAggregate {
    /** Distinct users per calendar month, keyed `YYYY-MM`. */
    usersByMonth: Map<string, Set<string>>;
    countries: Set<string>;
    contentLanguages: Set<string>;
    /** Distinct values of Language1Iso639Code, for Bloom Editor's Active Projects. */
    l1Languages: Set<string>;
    /** Users who fired their first-launch ("Created") event in the period. */
    firstLaunchUsers: Set<string>;
    eventCount: number;
}

export interface ExportAggregate {
    byBucket: Map<string, BucketAggregate>;
    totalEvents: number;
    /**
     * Events skipped for having no `distinct_id` or no `time`. Counted rather than
     * dropped in silence: they cannot be attributed to a user or a month, so they
     * genuinely cannot be counted, but a figure that has quietly ignored part of
     * its input should say so.
     */
    skippedEvents: number;
}

const emptyBucketAggregate = (): BucketAggregate => ({
    usersByMonth: new Map(),
    countries: new Set(),
    contentLanguages: new Set(),
    l1Languages: new Set(),
    firstLaunchUsers: new Set(),
    eventCount: 0,
});

/** Which bucket names an event's `host` belongs to (a host can feed several). */
const bucketsFor = (host: string | undefined): string[] => {
    const names: string[] = ["all"];
    for (const bucket of Object.values(BUCKETS)) {
        if (bucket.name === "all") continue;
        const matches = bucket.hosts.some((h) =>
            h === null ? host === undefined : h === host
        );
        if (matches) names.push(bucket.name);
    }
    return names;
};

/**
 * A quarter's export is hundreds of megabytes and takes minutes, and every
 * Mixpanel column for a product comes out of the same pass -- so memoise the
 * whole aggregate per (project, period) for the life of the run.
 */
const aggregateCache = new Map<string, Promise<ExportAggregate>>();

/**
 * The one way to get a project's counts for a period. Every Mixpanel-backed column
 * goes through here so they all share a single export.
 *
 * The cache stores the promise rather than the result, which is the whole point:
 * seven columns ask for the same project at once, and storing the result would let
 * all seven start their own export before the first finished. Raw export is also
 * the only endpoint this plan allows — every aggregate endpoint returns 402 — so a
 * duplicated pass costs minutes, not milliseconds.
 */
export const getExportAggregate = (
    project: MixpanelProjectKey,
    period: Period
): Promise<ExportAggregate> => {
    const key = `${project}|${period.from}|${period.to}`;
    const cached = aggregateCache.get(key);
    if (cached) return cached;
    const pending = runExport(project, period);
    aggregateCache.set(key, pending);
    return pending;
};

/** Streams the export, aggregating as it goes; event data is never retained. */
const runExport = async (
    project: MixpanelProjectKey,
    period: Period
): Promise<ExportAggregate> => {
    const host = process.env.MIXPANEL_DATA_HOST ?? "https://data.mixpanel.com";
    const url = new URL("/api/2.0/export", host);
    url.searchParams.set("project_id", mixpanelProjectId(project));
    url.searchParams.set("from_date", period.from);
    url.searchParams.set("to_date", period.to);

    const response = await fetch(url, {
        headers: { Authorization: mixpanelAuthHeader() },
    });
    if (!response.ok) {
        throw new Error(
            `Mixpanel export for ${project} returned ${response.status}: ${(await response.text()).slice(0, 300)}`
        );
    }
    if (!response.body) {
        throw new Error(`Mixpanel export for ${project} returned no body.`);
    }

    const byBucket = new Map<string, BucketAggregate>();
    let totalEvents = 0;
    let skippedEvents = 0;
    let remainder = "";

    const handleLine = (line: string): void => {
        if (!line.trim()) return;
        totalEvents++;
        const parsed = JSON.parse(line) as {
            event?: string;
            properties?: Record<string, unknown>;
        };
        const properties = parsed.properties;
        if (!properties) {
            skippedEvents++;
            return;
        }

        const user = properties.distinct_id;
        if (typeof user !== "string") {
            skippedEvents++;
            return;
        }
        // Mixpanel export `time` is epoch seconds in the project's timezone.
        const time = properties.time;
        if (typeof time !== "number") {
            skippedEvents++;
            return;
        }
        const month = new Date(time * 1000).toISOString().slice(0, 7);

        const country = properties.mp_country_code;
        const contentLang = properties.contentLang;
        const l1 = properties.Language1Iso639Code;
        const eventHost =
            typeof properties.host === "string" ? properties.host : undefined;

        for (const name of bucketsFor(eventHost)) {
            let aggregate = byBucket.get(name);
            if (!aggregate) {
                aggregate = emptyBucketAggregate();
                byBucket.set(name, aggregate);
            }
            aggregate.eventCount++;
            let monthUsers = aggregate.usersByMonth.get(month);
            if (!monthUsers) {
                monthUsers = new Set();
                aggregate.usersByMonth.set(month, monthUsers);
            }
            monthUsers.add(user);
            if (typeof country === "string" && country) {
                aggregate.countries.add(country);
            }
            if (typeof contentLang === "string" && contentLang) {
                aggregate.contentLanguages.add(contentLang);
            }
            if (typeof l1 === "string" && l1) aggregate.l1Languages.add(l1);
            if (parsed.event === FIRST_LAUNCH_EVENT) {
                aggregate.firstLaunchUsers.add(user);
            }
        }
    };

    // A streaming decoder, not per-chunk Buffer.toString: a multi-byte character
    // straddling a chunk boundary would otherwise be decoded as two broken
    // halves, corrupting whichever id or language code it landed in.
    const decoder = new TextDecoder("utf-8");
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
        const lines = (
            remainder + decoder.decode(chunk, { stream: true })
        ).split("\n");
        remainder = lines.pop() ?? "";
        for (const line of lines) handleLine(line);
    }
    handleLine(remainder + decoder.decode());

    return { byBucket, totalEvents, skippedEvents };
};

/**
 * Reduces the aggregate to one number. Throws rather than guessing if the bucket
 * produced no events or the period is not the three months a quarter implies.
 */
export const measureFromAggregate = (
    aggregate: ExportAggregate,
    bucketName: string,
    measure: ExportMeasure,
    period: Period
): number => {
    const bucket = aggregate.byBucket.get(bucketName);
    if (!bucket) {
        throw new Error(
            `No events in bucket "${bucketName}" for this period (buckets seen: ${[...aggregate.byBucket.keys()].join(", ") || "none"}).`
        );
    }

    const months = monthsInPeriod(period).map(
        (yearMonth) => `${yearMonth.slice(0, 4)}-${yearMonth.slice(4)}`
    );
    const monthlyCounts = months.map(
        (month) => bucket.usersByMonth.get(month)?.size ?? 0
    );

    // The dashboard has exactly three MAU columns and one average across them, so
    // these measures can only describe a three-month period. The guard used to be
    // "is there a month N", which caught a shorter period but let a longer one
    // through in silence: --from 2026-01-01 --to 2026-12-31 averaged twelve months
    // into Avg MAU while the three MAU columns showed January to March, and the
    // headers named those same three months. The row looked like a normal quarter.
    if (measure === "avgMau" || /^mau-[123]$/.test(measure)) {
        if (months.length !== 3) {
            throw new Error(
                `${measure} describes a three-month quarter, but ${period.from}..${period.to} covers ${months.length} month(s). Use a quarter.`
            );
        }
    }

    const monthly = /^mau-([123])$/.exec(measure);
    if (monthly) {
        return monthlyCounts[Number(monthly[1]) - 1]!;
    }

    switch (measure) {
        case "activeUsers": {
            // Distinct across the whole period, so union the months rather than
            // summing them -- a user active in April and May counts once.
            const union = new Set<string>();
            for (const month of months) {
                for (const user of bucket.usersByMonth.get(month) ?? []) {
                    union.add(user);
                }
            }
            return union.size;
        }
        case "avgMau":
            return (
                Math.round(
                    (monthlyCounts.reduce((a, b) => a + b, 0) /
                        monthlyCounts.length) *
                        100
                ) / 100
            );
        case "userCountries":
            return bucket.countries.size;
        case "contentLanguages":
            return bucket.contentLanguages.size;
        case "l1Languages":
            return bucket.l1Languages.size;
        case "installs": {
            // Over a whole quarter there are always some first launches, so zero
            // means the event name changed, not that nobody installed Bloom.
            if (bucket.firstLaunchUsers.size === 0) {
                throw new Error(
                    `No "${FIRST_LAUNCH_EVENT}" events in ${bucket.eventCount} events -- the first-launch event name has probably changed.`
                );
            }
            return bucket.firstLaunchUsers.size;
        }
        default:
            throw new Error(`Unhandled export measure "${measure}".`);
    }
};
