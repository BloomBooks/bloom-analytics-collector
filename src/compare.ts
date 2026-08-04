import { readFile } from "node:fs/promises";
import { METRIC_ORDER, PRODUCT_NAMES, PRODUCT_ORDER } from "./metrics.js";
import type { DashboardLayout } from "./output.js";
import { headerFor } from "./output.js";
import type { MetricId, MetricResult, Period, ProductId } from "./types.js";

/**
 * A quarter's hand-collected values, keyed by product then metric. Used to check
 * this tool against a quarter a human already did -- the only way to know
 * whether our definitions match the ones the saved Mixpanel reports use.
 */
type KnownGood = Partial<
    Record<ProductId, Partial<Record<MetricId, string | number>>>
>;

/**
 * Reads a quarter's hand-collected baseline.
 *
 * Every product and column name is checked against the real ones rather than taken
 * as written, because a typo in a key is invisible where it matters: the metric it
 * was meant to name just goes uncompared, and the run still reports agreement on
 * everything else. A baseline that silently checks less than you believe is worse
 * than having none, because it is the thing being trusted.
 */
export const loadKnownGood = async (path: string): Promise<KnownGood> => {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Record<
        string,
        unknown
    >;
    const known: KnownGood = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (key.startsWith("//")) continue;
        // Validate the names. A mistyped product or column would otherwise mean
        // "this metric is simply not compared", which is the one failure a
        // baseline must never have: the run would report no mismatches while
        // quietly checking less than it claims.
        if (!PRODUCT_ORDER.includes(key as ProductId)) {
            throw new Error(
                `${path}: "${key}" is not a product. Expected one of ${PRODUCT_ORDER.join(", ")}.`
            );
        }
        const perMetric: Partial<Record<MetricId, string | number>> = {};
        for (const [metric, expected] of Object.entries(
            value as Record<string, unknown>
        )) {
            if (metric.startsWith("//")) continue;
            if (!METRIC_ORDER.includes(metric as MetricId)) {
                throw new Error(
                    `${path}: "${key}.${metric}" is not a known column. Expected one of ${METRIC_ORDER.join(", ")}.`
                );
            }
            perMetric[metric as MetricId] = expected as string | number;
        }
        known[key as ProductId] = perMetric;
    }
    return known;
};

/** How closely a collected value matches the hand-collected one. */
type Verdict = "exact" | "close" | "off" | "missing" | "extra";

/**
 * Counts drawn from a live analytics stream are not expected to be bit-identical
 * to a number a human read off a dashboard weeks earlier -- late-arriving events
 * and Mixpanel's own recomputation both move them slightly. So within 1% counts
 * as agreement, and anything further apart is worth investigating.
 */
const CLOSE_ENOUGH_FRACTION = 0.01;

const classify = (
    actual: string | number | null,
    expected: string | number | undefined
): Verdict => {
    if (expected === undefined) return actual === null ? "missing" : "extra";
    if (actual === null) return "missing";
    if (typeof expected === "number" && typeof actual === "number") {
        if (actual === expected) return "exact";
        const spread =
            Math.abs(actual - expected) / Math.max(Math.abs(expected), 1);
        return spread <= CLOSE_ENOUGH_FRACTION ? "close" : "off";
    }
    return String(actual).trim() === String(expected).trim() ? "exact" : "off";
};

const MARK: Record<Verdict, string> = {
    exact: "==",
    close: "~=",
    off: "!!",
    missing: "..",
    extra: "++",
};

/**
 * Prints a per-metric comparison and returns the number of metrics that did not
 * come out clean -- those that differ, plus those the baseline expects that were
 * not collected at all. The second kind matters as much as the first: a run that
 * silently checks less than the baseline asks for should not read as agreement.
 *
 * "extra" (we collected something the hand-collected quarter left blank) is
 * reported but is not a problem -- it is the tool doing more than the manual
 * process did.
 */
export const reportComparison = (
    results: MetricResult[],
    known: KnownGood,
    layout: DashboardLayout,
    period: Period
): number => {
    console.log(
        "\nComparison with hand-collected values  ( == exact  ~= within 1%  !! differs  .. we have nothing  ++ we have extra )"
    );
    let mismatches = 0;
    let uncheckable = 0;

    for (const product of PRODUCT_ORDER) {
        const expectedForProduct = known[product];
        if (!expectedForProduct) continue;
        console.log(`\n${PRODUCT_NAMES[product]}`);
        for (const result of results.filter((r) => r.product === product)) {
            const expected = expectedForProduct[result.metric];
            // Skip columns neither side has an opinion about.
            if (expected === undefined && result.value === null) continue;
            const verdict = classify(result.value, expected);
            if (verdict === "off") mismatches++;
            // A baseline value we did not collect is not agreement. Counting it
            // separately keeps the summary from announcing "0 differ" when it
            // checked fewer metrics than the baseline asked for.
            if (verdict === "missing") uncheckable++;
            const label = headerFor(layout, result.metric, period).padEnd(30);
            const ours = String(result.value ?? "-").padStart(12);
            const theirs = String(expected ?? "-").padStart(12);
            console.log(`  ${MARK[verdict]} ${label} ours ${ours}   theirs ${theirs}`);
        }
    }

    console.log(
        `\n${mismatches} metric(s) differ by more than ${CLOSE_ENOUGH_FRACTION * 100}%.` +
            (uncheckable > 0
                ? ` ${uncheckable} metric(s) the baseline expects were not collected, so they were NOT checked.`
                : "")
    );
    return mismatches + uncheckable;
};
