import { readFile } from "node:fs/promises";
import { PRODUCT_NAMES, PRODUCT_ORDER } from "./metrics.js";
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

export const loadKnownGood = async (path: string): Promise<KnownGood> => {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Record<
        string,
        unknown
    >;
    const known: KnownGood = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (key.startsWith("//")) continue;
        known[key as ProductId] = value as Partial<
            Record<MetricId, string | number>
        >;
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
 * Prints a per-metric comparison and returns the count of genuine mismatches.
 * "extra" (we collected something the human left blank) is reported but is not a
 * mismatch -- it is the tool doing more than the manual process did.
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
            const label = headerFor(layout, result.metric, period).padEnd(30);
            const ours = String(result.value ?? "-").padStart(12);
            const theirs = String(expected ?? "-").padStart(12);
            console.log(`  ${MARK[verdict]} ${label} ours ${ours}   theirs ${theirs}`);
        }
    }

    console.log(
        `\n${mismatches} metric(s) differ by more than ${CLOSE_ENOUGH_FRACTION * 100}%.`
    );
    return mismatches;
};
