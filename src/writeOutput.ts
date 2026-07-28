import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { METRIC_ORDER, PRODUCT_NAMES, PRODUCT_ORDER } from "./metrics.js";
import { buildFullPasteBlock, headerFor } from "./output.js";
import { sanitizeForOutput } from "./sanitize.js";
import type { DashboardLayout } from "./output.js";
import type { MetricResult, Period, ProductId } from "./types.js";

/**
 * Writes a quarter's results to files rather than leaving them in the terminal:
 * a paste grid to open and copy wholesale, and a report recording every value,
 * where it came from, and what is still blank.
 *
 * Files are named for the quarter and kept, so the folder accumulates a record of
 * past quarters.
 */
export interface WrittenFiles {
    pastePath: string;
    reportPath: string;
    runPath: string;
    anchor: string | null;
    gaps: { product: ProductId; metric: string; reason: string }[];
}

const STATUS_WORD: Record<MetricResult["status"], string> = {
    ok: "collected",
    manual: "needs a person",
    unavailable: "not applicable",
    error: "failed",
};

export const writeQuarterFiles = async (
    directory: string,
    period: Period,
    rawResults: MetricResult[],
    layout: DashboardLayout
): Promise<WrittenFiles> => {
    await mkdir(directory, { recursive: true });

    // Everything persisted here is committed, and this repo is public, so
    // provenance is redacted on the way out. The terminal keeps the full text --
    // see src/sanitize.ts for what leaked before this existed.
    const results = rawResults.map((result) => ({
        ...result,
        provenance: sanitizeForOutput(result.provenance),
    }));

    const block = buildFullPasteBlock(results, layout, PRODUCT_ORDER, period);
    const anchor = block?.anchor ?? null;

    // The paste file holds nothing but the grid, so it can be opened, selected
    // and copied without stripping commentary out first. The anchor cell is in
    // the file name instead.
    const pasteName = anchor
        ? `${period.slug}.paste-at-${anchor}.tsv`
        : `${period.slug}.paste.tsv`;
    const pastePath = join(directory, pasteName);
    await writeFile(pastePath, block ? `${block.tsv}\n` : "", "utf8");

    const gaps = results
        .filter((r) => r.status === "manual" || r.status === "error")
        .map((r) => ({
            product: r.product,
            metric: headerFor(layout, r.metric, period),
            reason: r.provenance,
        }));

    const reportPath = join(directory, `${period.slug}.report.md`);
    await writeFile(
        reportPath,
        buildReport(period, results, layout, anchor, gaps),
        "utf8"
    );

    const runPath = join(directory, `${period.slug}.run.json`);
    await writeFile(
        runPath,
        `${JSON.stringify({ period, results }, null, 2)}\n`,
        "utf8"
    );

    return { pastePath, reportPath, runPath, anchor, gaps };
};

/** The human-readable record: what went in each cell and where it came from. */
const buildReport = (
    period: Period,
    results: MetricResult[],
    layout: DashboardLayout,
    anchor: string | null,
    gaps: { product: ProductId; metric: string; reason: string }[]
): string => {
    const lines: string[] = [];
    lines.push(`# LangTech metrics — ${period.label}`);
    lines.push("");
    lines.push(`Reporting period ${period.from} to ${period.to}.`);
    lines.push("");

    if (anchor) {
        lines.push(
            `Paste \`${period.slug}.paste-at-${anchor}.tsv\` into the dashboard at cell **${anchor}**: select that cell, then paste. The grid covers all four products in dashboard row order, and blank cells are values we do not have — see the gaps below.`
        );
    } else {
        lines.push(
            "No paste grid was produced: the dashboard layout has no product rows recorded, or nothing was collected."
        );
    }
    lines.push("");

    lines.push("## Values");
    lines.push("");
    for (const product of PRODUCT_ORDER) {
        lines.push(`### ${PRODUCT_NAMES[product]}`);
        lines.push("");
        lines.push("| Column | Value | Status | Source |");
        lines.push("| --- | --- | --- | --- |");
        for (const metric of METRIC_ORDER) {
            const result = results.find(
                (r) => r.product === product && r.metric === metric
            );
            if (!result) continue;
            const value =
                result.value === null ? "" : `\`${String(result.value)}\``;
            lines.push(
                `| ${headerFor(layout, metric, period)} | ${value} | ${STATUS_WORD[result.status]} | ${result.provenance.replace(/\|/g, "\\|")} |`
            );
        }
        lines.push("");
    }

    lines.push("## Still to fill in by hand");
    lines.push("");
    if (gaps.length === 0) {
        lines.push("Nothing — every column this tool covers was collected.");
    } else {
        for (const gap of gaps) {
            lines.push(
                `- **${PRODUCT_NAMES[gap.product]} — ${gap.metric}**: ${gap.reason}`
            );
        }
    }
    lines.push("");
    lines.push(
        "Columns outside the pasted range are untouched: Product Name, the unlabelled column B, Owner Sign off and Approved by Chris to the left, and New Support Tickets, New Community Topics and Notes to the right."
    );
    lines.push("");
    return `${lines.join("\n")}`;
};
