import type {
    MetricId,
    MixpanelProjectKey,
    ProductId,
    Source,
} from "./types.js";

/**
 * The single source of truth for "where does each number come from".
 *
 * This is a transcription of the "Bloom - Analytics Collection" Google Doc
 * (docs/manual-process.md has the prose version), mapped onto the dashboard's
 * actual columns. When the manual process changes, change it here.
 *
 * `pnpm collect --check` lists every metric still waiting on a human.
 */

/**
 * The saved reports on the "LangTech metrics" board of the BloomLibrary.org
 * Mixpanel project, recorded for reference: these are the canonical definitions
 * of each metric, and the numbers this tool computes should be validated against
 * them in the Mixpanel UI.
 *
 * They are NOT used at runtime. Our Mixpanel plan rejects every aggregate query
 * endpoint with HTTP 402, so saved reports cannot be executed programmatically;
 * the numbers are computed from the raw event export instead. See
 * src/sources/mixpanelExport.ts.
 *
 *   Active Users                 87229749
 *   Avg MAU                      87229821
 *   Count of User Countries      89533934
 *   Count of Content Languages   89534035
 *   Top User (Unique) Countries  87229849  (no longer a dashboard column)
 */

/** The dashboard's own product names, for output that matches the sheet. */
export const PRODUCT_NAMES: Record<ProductId, string> = {
    bloomEditor: "Bloom Editor",
    bloomLibrary: "Bloom Library",
    bloomReader: "Bloom Reader",
    bloomPubViewer: "BloomPUB Viewer",
};

/**
 * The seven user-metric columns every product shares -- Active Users, Avg MAU,
 * the three MAU months, User Countries and Languages Impacted -- all computed
 * from one pass over that product's slice of the raw export.
 */
const userMetrics = (
    project: MixpanelProjectKey,
    bucket: string,
    /**
     * Which property carries "language impacted". The web/reader products tag
     * events with the language of the book being read (`contentLang`); Bloom
     * Editor instead tags them with the collection's first vernacular language
     * (`Language1Iso639Code`).
     */
    languageMeasure: "contentLanguages" | "l1Languages" = "contentLanguages"
): Partial<Record<MetricId, Source>> => {
    const base = { kind: "mixpanel-export", project, bucket } as const;
    return {
        activeUsers: {
            ...base,
            measure: "activeUsers",
            note: "Distinct users over the whole period -- the months are unioned, not summed.",
        },
        avgMau: { ...base, measure: "avgMau" },
        mauMonth1: { ...base, measure: "mau-1" },
        mauMonth2: { ...base, measure: "mau-2" },
        mauMonth3: { ...base, measure: "mau-3" },
        // Distinct mp_country_code on events. What the dashboard deprecated is the
        // Top 5 User Countries breakdown (its Country 1-5 columns are gone from
        // the FY26Q3 layout); this total is still wanted, in column S.
        numberOfUserCountries: { ...base, measure: "userCountries" },
        numberOfLanguagesImpacted: { ...base, measure: languageMeasure },
    };
};

export const METRIC_SOURCES: Record<
    ProductId,
    Partial<Record<MetricId, Source>>
> = {
    bloomEditor: {
        latestReleaseVersion: {
            kind: "bloom-installers",
            want: "version",
            note: "The manual process reads this off TeamCity; we take it from the published installer instead, which is the same release seen from the other end.",
        },
        latestReleaseDate: { kind: "bloom-installers", want: "date" },
        numberOfReleases: {
            kind: "bloom-installers",
            want: "count",
            note: "The installers page on bloomlibrary.org is fed by this same S3 bucket, so counting the bucket counts what the manual process counts. Release channel only -- see the doc's note about why counting Alpha/Beta/Internal was abandoned.",
        },
        supportedFte: {
            kind: "manual",
            where: "no analytics source -- put it in config/manual/<quarter>.json",
        },
        paidFte: {
            kind: "manual",
            where: "no analytics source -- put it in config/manual/<quarter>.json",
        },
        downloads: { kind: "unavailable", reason: "We do not collect this." },
        installs: {
            kind: "mixpanel-export",
            project: "bloomEditor",
            bucket: "all",
            measure: "installs",
            note: "The doc's '(Created, Unique Users)': distinct users with a 'Created' event, which DesktopAnalytics emits on a user's first launch on a system.",
        },
        activeProjects: {
            kind: "mixpanel-export",
            project: "bloomEditor",
            bucket: "all",
            measure: "l1Languages",
            note: "Distinct Language1Iso639Code. The doc notes this is a fallback: a collection is not a project, so active L1 languages stands in for active projects. This is deliberately identical to Number of Languages Impacted -- confirmed intended, and the hand-collected FY26Q2 sheet has the same number (701) in both columns.",
        },
        newProjectsStarted: {
            kind: "manual",
            where: "Mixpanel -> Bloom Editor -> Applications -> JQL -> 'count - L1 first seen date is in period'",
            note: "Stays manual by decision (2026-07-28). JQL is blocked by the plan (402), and computing it from the raw export needs each language's FIRST-EVER appearance -- all history since 2012 -- so it would want a one-time bulk backfill into a cached language -> first-seen-date file, then a top-up each quarter. Not worth building yet.",
        },
        // Bloom Editor sets no `host`, so the whole project is one bucket. Its
        // "languages impacted" is Language1Iso639Code, not contentLang.
        ...userMetrics("bloomEditor", "all", "l1Languages"),
    },

    bloomLibrary: {
        // The doc's "GHA" means the "Build and Deploy" workflow: a release here is
        // a production deploy, not a versioned artifact. Counting its successful
        // runs for Jan-Mar 2026 gives 41, matching the hand-collected figure
        // exactly (43 runs, 2 of them failed). Runs on every branch count -- the
        // repo deploys from master, release and embed.
        latestReleaseVersion: {
            kind: "unavailable",
            reason: "A website has no version number; the dashboard records 'Not versioned'.",
        },
        latestReleaseDate: {
            kind: "github-workflow-runs",
            repo: "BloomBooks/BloomLibrary2",
            workflow: "Build and Deploy",
            want: "date",
        },
        numberOfReleases: {
            kind: "github-workflow-runs",
            repo: "BloomBooks/BloomLibrary2",
            workflow: "Build and Deploy",
            want: "count",
        },
        supportedFte: {
            kind: "manual",
            where: "no analytics source -- put it in config/manual/<quarter>.json",
        },
        paidFte: {
            kind: "manual",
            where: "no analytics source -- put it in config/manual/<quarter>.json",
        },
        downloads: { kind: "unavailable", reason: "n/a for the website" },
        installs: { kind: "unavailable", reason: "n/a for the website" },
        activeProjects: { kind: "unavailable", reason: "n/a for the website" },
        newProjectsStarted: {
            kind: "unavailable",
            reason: "n/a for the website",
        },
        ...userMetrics("bloomLibrary", "bloomlibrary.org"),
    },

    bloomReader: {
        // No Google API exposes Play release history, and this repo publishes no
        // GitHub Releases -- but it does tag them, and the tags line up with the
        // Play production history: tag v3.4.5 is dated 2026-02-05 against a
        // hand-recorded Play release of 3.4.5 on 2026-02-06, and it is the only
        // release tag in that quarter, matching the recorded count of 1.
        // Expect the date to run a day or so behind Play's publish date.
        latestReleaseVersion: {
            kind: "github-tags",
            repo: "BloomBooks/BloomReader",
            want: "version",
        },
        latestReleaseDate: {
            kind: "github-tags",
            repo: "BloomBooks/BloomReader",
            want: "date",
            note: "Tag date, which can be a day earlier than Play's publish date.",
        },
        numberOfReleases: {
            kind: "github-tags",
            repo: "BloomBooks/BloomReader",
            want: "count",
            note: "Release tags only: the repo's history also has -beta tags, which are excluded.",
        },
        supportedFte: {
            kind: "manual",
            where: "no analytics source -- put it in config/manual/<quarter>.json",
        },
        paidFte: {
            kind: "manual",
            where: "no analytics source -- put it in config/manual/<quarter>.json",
        },
        downloads: {
            kind: "unavailable",
            reason: "Play Console does not distinguish download from install, and we do not track direct downloads from bloomlibrary.org.",
        },
        // Play's bulk-report column "Daily Device Installs" is the uniques-based
        // measure the dashboard's definition asks for ("Unique first-run"), which
        // took some pinning down. In Google's taxonomy the statistics report offers
        // "Device acquisition > New devices" (uniques) alongside "All device
        // acquisitions" and "Install events" (both events-based), and the earlier
        // hand-collected figures came from the events variant -- 2434 for Jan-Mar
        // 2026 where uniques is 1573, so those overcounted by about half again.
        //
        // Verified against the UI's New devices / Unique devices report, monthly:
        //   UI   482  486  602  821  1001  642   (Jan-Jun 2026)
        //   CSV  482  486  605  814   990  642
        // The residual is data still settling, well inside the 1% the comparison
        // allows.
        installs: {
            kind: "play-installs",
            packageName: "org.sil.bloom.reader",
            note: "Daily Device Installs summed over the quarter -- Google's uniques-based 'New devices', not the events-based 'All device acquisitions'.",
        },
        activeProjects: { kind: "unavailable", reason: "n/a for Bloom Reader" },
        newProjectsStarted: {
            kind: "unavailable",
            reason: "n/a for Bloom Reader",
        },
        ...userMetrics("bloomReaderRelease", "all"),
    },

    bloomPubViewer: {
        latestReleaseVersion: {
            kind: "github-releases",
            repo: "BloomBooks/bloompub-viewer",
            want: "version",
        },
        latestReleaseDate: {
            kind: "github-releases",
            repo: "BloomBooks/bloompub-viewer",
            want: "date",
        },
        numberOfReleases: {
            kind: "github-releases",
            repo: "BloomBooks/bloompub-viewer",
            want: "count",
        },
        supportedFte: {
            kind: "manual",
            where: "no analytics source -- put it in config/manual/<quarter>.json",
        },
        paidFte: {
            kind: "manual",
            where: "no analytics source -- put it in config/manual/<quarter>.json",
        },
        downloads: { kind: "unavailable", reason: "We do not have this info." },
        installs: { kind: "unavailable", reason: "We do not have this info." },
        activeProjects: { kind: "unavailable", reason: "n/a" },
        newProjectsStarted: { kind: "unavailable", reason: "n/a" },
        // Shares the BloomLibrary.org Mixpanel project; separated by host.
        ...userMetrics("bloomLibrary", "bloompubviewer"),
    },
};

/** Column order for console output; mirrors the dashboard left to right. */
export const METRIC_ORDER: MetricId[] = [
    "latestReleaseVersion",
    "latestReleaseDate",
    "numberOfReleases",
    "supportedFte",
    "paidFte",
    "downloads",
    "installs",
    "activeProjects",
    "newProjectsStarted",
    "activeUsers",
    "avgMau",
    "mauMonth1",
    "mauMonth2",
    "mauMonth3",
    "numberOfUserCountries",
    "numberOfLanguagesImpacted",
];

/** Row order in the dashboard: Editor, Library, Reader, BloomPUB Viewer. */
export const PRODUCT_ORDER: ProductId[] = [
    "bloomEditor",
    "bloomLibrary",
    "bloomReader",
    "bloomPubViewer",
];

/**
 * Lists every (product, metric) with no automated source -- those whose kind is
 * "manual" -- together with where a human must look it up. This is what --check
 * prints.
 */
export const findUnconfiguredSources = (): string[] => {
    const gaps: string[] = [];
    for (const product of PRODUCT_ORDER) {
        for (const metric of METRIC_ORDER) {
            const source = METRIC_SOURCES[product][metric];
            if (source?.kind === "manual") {
                gaps.push(`${product}.${metric}: ${source.where}`);
            }
        }
    }
    return gaps;
};
