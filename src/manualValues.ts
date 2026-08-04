import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { METRIC_ORDER, PRODUCT_ORDER } from "./metrics.js";
import type { MetricId, MetricResult, Period, ProductId } from "./types.js";

/**
 * Values that no source can produce, supplied by hand for one quarter in
 * `config/manual/<quarter>.json`.
 *
 * Without this, every such column arrives in the paste grid as a hole, and a hole
 * blanks the cell -- so the numbers had to be re-typed after every paste. Putting
 * them here instead means the grid is complete and pasting it once is enough.
 *
 * Supported FTE and Paid FTE will always live here; New Projects Started does
 * only until the Mixpanel JQL it needs can be run programmatically.
 */
export type ManualValues = Partial<
    Record<ProductId, Partial<Record<MetricId, string | number>>>
>;

const manualPath = (period: Period): string =>
    join("config", "manual", `${period.slug}.json`);

/**
 * Loads the quarter's hand-entered values, or an empty set if the file does not
 * exist. A malformed file is an error rather than a silent skip: it would
 * otherwise look exactly like "nothing was supplied".
 */
export const loadManualValues = async (
    period: Period
): Promise<{ values: ManualValues; path: string; found: boolean }> => {
    const path = manualPath(period);
    let raw: string;
    try {
        raw = await readFile(path, "utf8");
    } catch (error) {
        // A missing file is a normal state -- a quarter may need nothing entered
        // by hand. Any other failure is not, and must not be mistaken for one:
        // that would silently blank the very cells the file exists to fill.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return { values: {}, path, found: false };
        }
        throw new Error(
            `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const values: ManualValues = {};
    for (const [key, entry] of Object.entries(parsed)) {
        if (key.startsWith("//")) continue;
        if (!PRODUCT_ORDER.includes(key as ProductId)) {
            throw new Error(
                `${path}: "${key}" is not a product. Expected one of ${PRODUCT_ORDER.join(", ")}.`
            );
        }
        const perMetric: Partial<Record<MetricId, string | number>> = {};
        for (const [metric, value] of Object.entries(
            entry as Record<string, unknown>
        )) {
            if (metric.startsWith("//")) continue;
            if (!METRIC_ORDER.includes(metric as MetricId)) {
                throw new Error(
                    `${path}: "${key}.${metric}" is not a known column.`
                );
            }
            if (typeof value !== "string" && typeof value !== "number") {
                throw new Error(
                    `${path}: "${key}.${metric}" must be a string or a number.`
                );
            }
            perMetric[metric as MetricId] = value;
        }
        values[key as ProductId] = perMetric;
    }
    return { values, path, found: true };
};

/**
 * How a previously hand-entered value identifies itself in a saved run. Replaying
 * a run must be able to tell "a source produced this" from "a person typed this",
 * because the second kind should be re-read from the file in case it was fixed.
 */
const HAND_ENTERED = "hand-entered in ";

/**
 * Fills in hand-supplied values, marking them collected so they reach the paste
 * grid. Deliberately refuses to overwrite anything a source produced: if a column
 * later becomes automatic, the automated number wins and the stale hand-entered
 * one is reported rather than silently preferred.
 */
export const applyManualValues = (
    results: MetricResult[],
    values: ManualValues,
    path: string
): {
    results: MetricResult[];
    applied: number;
    superseded: string[];
    notApplicable: string[];
    refused: string[];
} => {
    // Three reasons to leave a hand-entered value out, kept apart because they mean
    // different things to whoever is running this, and only one deserves an alarm.
    // `superseded`: a source now produces the number, so the file's copy is stale.
    // `notApplicable`: the column does not apply to that product at all, so the
    // entry is simply stray. `refused`: the source FAILED, and substituting a
    // typed-in number would hide that behind a figure from who knows which quarter.
    const superseded: string[] = [];
    const notApplicable: string[] = [];
    const refused: string[] = [];
    let applied = 0;

    const merged = results.map((result) => {
        const supplied = values[result.product]?.[result.metric];
        if (supplied === undefined) return result;
        // A value already marked ok because a person typed it is not evidence that
        // a source produced it: re-read it, so correcting the manual file and
        // replaying with --from-json actually takes effect.
        const wasHandEntered =
            result.status === "ok" &&
            result.provenance.startsWith(HAND_ENTERED);
        if (result.status === "ok" && !wasHandEntered) {
            superseded.push(
                `${result.product}.${result.metric} (a source collected this as ${result.value}; the file's value is not used)`
            );
            return result;
        }
        // A column that does not apply to this product is not a failure. Someone
        // put a value in the file for a cell the dashboard does not want -- worth
        // mentioning so the stray entry gets removed, but not worth an alarm.
        if (result.status === "unavailable" && !wasHandEntered) {
            notApplicable.push(
                `${result.product}.${result.metric} (${result.provenance})`
            );
            return result;
        }
        // Only fill a cell that is genuinely waiting for a human. A source that
        // FAILED this run must keep its error: substituting a hand-entered number
        // would hide the failure behind a figure that could be from any quarter.
        if (result.status !== "manual" && !wasHandEntered) {
            refused.push(
                `${result.product}.${result.metric} (source status "${result.status}", not filled: ${result.provenance})`
            );
            return result;
        }
        applied++;
        return {
            ...result,
            value: supplied,
            status: "ok" as const,
            provenance: `${HAND_ENTERED}${path}`,
        };
    });

    // A supplied value for a column the run knows nothing about still belongs in
    // the grid. This happens when replaying a run saved before that column
    // existed, and would otherwise silently drop the value.
    for (const product of PRODUCT_ORDER) {
        for (const metric of METRIC_ORDER) {
            const supplied = values[product]?.[metric];
            if (supplied === undefined) continue;
            const present = merged.some(
                (r) => r.product === product && r.metric === metric
            );
            if (present) continue;
            applied++;
            merged.push({
                product,
                metric,
                value: supplied,
                status: "ok",
                provenance: `${HAND_ENTERED}${path}`,
            });
        }
    }

    return { results: merged, applied, superseded, notApplicable, refused };
};
