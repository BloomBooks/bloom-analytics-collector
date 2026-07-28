import { readFile } from "node:fs/promises";
import { monthLabelsInPeriod } from "./period.js";
import type { MetricId, MetricResult, Period, ProductId } from "./types.js";

/**
 * The dashboard's column layout: which metric sits in which column, in order,
 * starting at `startColumn`. `null` marks a column we never write: the product
 * name, or one filled in by hand.
 */
export interface DashboardLayout {
    /** A1 column letter of the first entry in `columns`, e.g. "A". */
    startColumn: string;
    columns: (MetricId | null)[];
    /** The sheet's own heading text, kept so a misalignment is caught early. */
    headers?: string[];
    /** Row number in the dashboard for each product, if known. */
    productRows?: Partial<Record<ProductId, number>>;
}

export const loadDashboardLayout = async (
    path: string
): Promise<DashboardLayout> => {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Record<
        string,
        unknown
    >;
    if (
        typeof parsed.startColumn !== "string" ||
        !Array.isArray(parsed.columns)
    ) {
        throw new Error(
            `${path} must have a "startColumn" string and a "columns" array.`
        );
    }
    // A headers list that has drifted out of step with `columns` would silently
    // shift every paste one cell sideways, so refuse to run on a mismatch.
    if (
        Array.isArray(parsed.headers) &&
        parsed.headers.length !== parsed.columns.length
    ) {
        throw new Error(
            `${path}: "headers" has ${parsed.headers.length} entries but "columns" has ${parsed.columns.length}. They must correspond one-to-one.`
        );
    }
    return parsed as unknown as DashboardLayout;
};

/**
 * The sheet's heading for a column, for output the human can cross-check.
 *
 * The three MAU columns are named for the quarter's months ("MAU Apr"), so their
 * recorded headers are only right for the quarter the layout was captured from.
 * Given a period, they are relabelled from it -- otherwise a Jan-Mar run prints
 * "MAU Apr / May / Jun" over January's numbers.
 */
export const headerFor = (
    layout: DashboardLayout,
    metric: MetricId,
    period?: Period
): string => {
    if (period) {
        const monthIndex = ["mauMonth1", "mauMonth2", "mauMonth3"].indexOf(
            metric
        );
        if (monthIndex >= 0) {
            const label = monthLabelsInPeriod(period)[monthIndex];
            if (label) return `MAU ${label}`;
        }
    }
    const index = layout.columns.indexOf(metric);
    return layout.headers?.[index] ?? metric;
};

/** Converts a zero-based column index to its A1 letter(s): 0 -> A, 26 -> AA. */
export const columnLetter = (index: number): string => {
    let letters = "";
    for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
        letters = String.fromCharCode(65 + (n % 26)) + letters;
    }
    return letters;
};

/** Converts an A1 column letter to its zero-based index: A -> 0, AA -> 26. */
export const columnIndex = (letter: string): number => {
    let index = 0;
    for (const character of letter.toUpperCase()) {
        index = index * 26 + (character.charCodeAt(0) - 64);
    }
    return index - 1;
};

const keyOf = (product: ProductId, metric: MetricId): string =>
    `${product}|${metric}`;

/** Every successfully collected value, keyed `product|metric`. */
const collectedValues = (
    results: MetricResult[]
): Map<string, string | number> => {
    const values = new Map<string, string | number>();
    for (const result of results) {
        if (result.status === "ok" && result.value !== null) {
            values.set(keyOf(result.product, result.metric), result.value);
        }
    }
    return values;
};

/**
 * One rectangle covering every column this tool populates, for all four products
 * — the whole quarter as a single paste.
 *
 * Cells we have no value for are left empty, which does blank whatever is in the
 * sheet. That is intended: an empty cell is the honest state of a number we do
 * not yet have, and the gaps are listed in the report so they can be filled in
 * afterwards (or supplied to us and included here next time).
 *
 * The rectangle spans from the first to the last column that any product has a
 * value for, so it never reaches the hand-entered columns beyond that range
 * (Owner Sign off and Approved by Chris to the left; New Support Tickets, New
 * Community Topics and Notes to the right). Supported FTE and Paid FTE fall inside
 * the span: they are filled from config/manual/<quarter>.json when it supplies
 * them (see manualValues.ts), and blank when it does not.
 */
export interface FullPasteBlock {
    /** Cell to select before pasting, e.g. "E4". */
    anchor: string;
    /** The grid: rows newline-separated, columns tab-separated. */
    tsv: string;
    /** One entry per column in the block, left to right. */
    columns: { metric: MetricId | null; header: string; filled: boolean }[];
    products: ProductId[];
}

export const buildFullPasteBlock = (
    results: MetricResult[],
    layout: DashboardLayout,
    productOrder: ProductId[],
    period: Period
): FullPasteBlock | null => {
    const rows = productOrder.map((p) => layout.productRows?.[p]);
    if (rows.some((row) => row === undefined)) return null;
    const rowNumbers = rows as number[];
    const consecutive = rowNumbers.every(
        (row, i) => i === 0 || row === rowNumbers[i - 1]! + 1
    );
    if (!consecutive) return null;

    const values = collectedValues(results);
    const hasAnyValue = (metric: MetricId | null): boolean =>
        metric !== null &&
        productOrder.some((product) => values.has(keyOf(product, metric)));

    const firstOffset = layout.columns.findIndex(hasAnyValue);
    if (firstOffset < 0) return null;
    let lastOffset = firstOffset;
    layout.columns.forEach((metric, offset) => {
        if (hasAnyValue(metric)) lastOffset = offset;
    });

    const span = layout.columns.slice(firstOffset, lastOffset + 1);
    const startIndex = columnIndex(layout.startColumn) + firstOffset;

    return {
        anchor: `${columnLetter(startIndex)}${rowNumbers[0]}`,
        tsv: productOrder
            .map((product) =>
                span
                    .map((metric) =>
                        metric === null
                            ? ""
                            : (values.get(keyOf(product, metric)) ?? "")
                    )
                    .join("\t")
            )
            .join("\n"),
        columns: span.map((metric) => ({
            metric,
            header:
                metric === null
                    ? "(not collected)"
                    : headerFor(layout, metric, period),
            filled: hasAnyValue(metric),
        })),
        products: productOrder,
    };
};
