/** The four products that get a row in the LangTech Software Metrics Dashboard. */
export type ProductId =
    | "bloomEditor"
    | "bloomLibrary"
    | "bloomReader"
    | "bloomPubViewer";

/**
 * The dashboard columns we can collect. Named after the spreadsheet's own column
 * headings (FY26Q3 layout), not after the Google Doc's headings, since the sheet
 * is what we have to fill in.
 *
 * Some of these have no analytics source and can only be supplied by hand, per
 * quarter, in config/manual/<quarter>.json -- Supported FTE and Paid FTE always,
 * and New Projects Started until the JQL it needs can be run. They are listed
 * here so they can be carried into the paste grid rather than left as holes.
 *
 * Columns the dashboard has that are still not here -- Owner Sign off, Approved
 * by Chris, New Support Tickets, New Community Topics, Notes/Comments -- are
 * outside the range this tool writes, so it never touches them.
 */
export type MetricId =
    | "latestReleaseVersion"
    | "latestReleaseDate"
    | "numberOfReleases"
    | "supportedFte"
    | "paidFte"
    | "downloads"
    | "installs"
    | "activeProjects"
    | "newProjectsStarted"
    | "activeUsers"
    | "avgMau"
    | "mauMonth1"
    | "mauMonth2"
    | "mauMonth3"
    | "numberOfUserCountries"
    | "numberOfLanguagesImpacted";

/** An inclusive reporting period, as ISO `YYYY-MM-DD` dates. */
export interface Period {
    from: string;
    to: string;
    /** Human label for logs and the sheet, e.g. "FY26 Q3 (Apr-Jun 2026)". */
    label: string;
    /** Filename-safe identifier for this period, e.g. "FY26Q3". */
    slug: string;
}

/**
 * What to compute from a Mixpanel raw-event export. `mau-N` is the Nth month of
 * the period, for the MAU Apr/May/Jun columns.
 */
export type ExportMeasure =
    | "activeUsers"
    | "avgMau"
    | "mau-1"
    | "mau-2"
    | "mau-3"
    | "userCountries"
    | "contentLanguages"
    | "l1Languages"
    | "installs";

/** Which part of a release to report: the version string or the date. */
export type ReleaseField = "count" | "version" | "date";

/**
 * Where a single (product, metric) value comes from. `kind` selects the
 * collector in src/sources; the remaining fields are that collector's config.
 */
export type Source =
    /**
     * Computed from Mixpanel's raw event export. The aggregate query APIs are
     * blocked on our plan (HTTP 402), so this is the only programmatic route.
     */
    | {
          kind: "mixpanel-export";
          project: MixpanelProjectKey;
          /** Which slice of the project's traffic, by `host`. See BUCKETS. */
          bucket: string;
          measure: ExportMeasure;
          note?: string;
      }
    /** Monthly install totals from the Play Console bulk report CSVs in GCS. */
    | { kind: "play-installs"; packageName: string; note?: string }
    /** GitHub releases in the period. */
    | {
          kind: "github-releases";
          repo: string;
          want: ReleaseField;
          note?: string;
      }
    /**
     * Git tags in the period, for repos that tag releases without publishing
     * GitHub Releases.
     */
    | {
          kind: "github-tags";
          repo: string;
          want: ReleaseField;
          note?: string;
      }
    /**
     * Successful runs of a named GitHub Actions workflow, for products whose
     * "release" is a deploy rather than a versioned artifact.
     */
    | {
          kind: "github-workflow-runs";
          repo: string;
          /** Workflow name as shown in the Actions tab, e.g. "Build and Deploy". */
          workflow: string;
          want: ReleaseField;
          note?: string;
      }
    /**
     * Bloom Editor releases, from the public S3 bucket that also feeds the
     * bloomlibrary.org installers page.
     */
    | { kind: "bloom-installers"; want: ReleaseField; note?: string }
    /** No automated route; a human must look it up. `where` is shown in the report. */
    | { kind: "manual"; where: string; note?: string }
    /** We genuinely do not have this number, or it does not apply to this product. */
    | { kind: "unavailable"; reason: string };

export type MixpanelProjectKey =
    | "bloomEditor"
    | "bloomReaderRelease"
    | "bloomLibrary";

/** One collected cell: the value plus enough provenance to audit it. */
export interface MetricResult {
    product: ProductId;
    metric: MetricId;
    /** Null when the value could not be collected (manual/unavailable/error). */
    value: string | number | null;
    status: "ok" | "manual" | "unavailable" | "error";
    /** Where it came from, or why it is missing. Always populated. */
    provenance: string;
}
