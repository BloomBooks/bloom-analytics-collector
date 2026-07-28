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
    } catch {
        return { values: {}, path, found: false };
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
 * Fills in hand-supplied values, marking them collected so they reach the paste
 * grid. Deliberately refuses to overwrite anything a source produced: if a column
 * later becomes automatic, the automated number wins and the stale hand-entered
 * one is reported rather than silently preferred.
 */
export const applyManualValues = (
    results: MetricResult[],
    values: ManualValues,
    path: string
): { results: MetricResult[]; applied: number; ignored: string[] } => {
    const ignored: string[] = [];
    let applied = 0;

    const merged = results.map((result) => {
        const supplied = values[result.product]?.[result.metric];
        if (supplied === undefined) return result;
        if (result.status === "ok") {
            ignored.push(
                `${result.product}.${result.metric} (collected automatically as ${result.value})`
            );
            return result;
        }
        applied++;
        return {
            ...result,
            value: supplied,
            status: "ok" as const,
            provenance: `hand-entered in ${path}`,
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
                provenance: `hand-entered in ${path}`,
            });
        }
    }

    return { results: merged, applied, ignored };
};
