import { readFile } from "node:fs/promises";
import "dotenv/config";
import { collectAll } from "./collect.js";
import { loadKnownGood, reportComparison } from "./compare.js";
import {
    findUnconfiguredSources,
    PRODUCT_NAMES,
    PRODUCT_ORDER,
} from "./metrics.js";
import { buildFullPasteBlock, headerFor, loadDashboardLayout } from "./output.js";
import { applyManualValues, loadManualValues } from "./manualValues.js";
import { inferSlug, parseQuarter, periodFromDates } from "./period.js";
import { writeQuarterFiles } from "./writeOutput.js";
import type { DashboardLayout } from "./output.js";
import type { MetricResult, Period } from "./types.js";

const USAGE = `
Collect the quarterly LangTech metrics for the Bloom products.

  pnpm collect --quarter FY26Q3              collect and print
  pnpm collect --from 2026-04-01 --to 2026-06-30
  pnpm collect --from-json output/FY26Q3.run.json    rewrite the files without re-collecting
  pnpm collect --quarter FY26Q2 --compare config/known-good/FY26Q2.json
  pnpm collect --check                       report which sources are unconfigured

Options
  --quarter <FY26Q3|2026Q2>  reporting period (FY quarters start in October)
  --from/--to <YYYY-MM-DD>   explicit reporting period
  --out <dir>                where to write the output files (default: output)
  --paste                    also print the paste blocks to the terminal
  --compare <path>           diff against hand-collected values for the quarter
  --from-json <path>         re-print a saved run instead of collecting again
  --check                    list unconfigured sources and exit

Each run writes three files into the output folder, named for the quarter and kept
as a record: a .tsv paste grid, a .report.md of every value and its source, and a
.run.json.

This tool never writes to the dashboard spreadsheet itself.
`;

/** Parses argv into a flag map, accepting "--flag value" and bare "--flag". */
const parseArgs = (argv: string[]): Record<string, string | true> => {
    const flags: Record<string, string | true> = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (!arg.startsWith("--")) continue;
        const name = arg.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
            flags[name] = next;
            i++;
        } else {
            flags[name] = true;
        }
    }
    return flags;
};

const resolvePeriod = (flags: Record<string, string | true>): Period => {
    if (typeof flags.quarter === "string") return parseQuarter(flags.quarter);
    if (typeof flags.from === "string" && typeof flags.to === "string") {
        return periodFromDates(flags.from, flags.to);
    }
    throw new Error("Specify either --quarter or both --from and --to.");
};

const STATUS_MARK = {
    ok: "  ",
    manual: "M ",
    unavailable: "- ",
    error: "! ",
} as const;

/**
 * Prints results grouped by product, with the reason for every missing value.
 * Columns are labelled with the dashboard's own heading text so the output can
 * be read straight against the sheet.
 */
const printResults = (
    results: MetricResult[],
    period: Period,
    layout: DashboardLayout
): void => {
    console.log(`\nPeriod: ${period.label}  [${period.from} .. ${period.to}]`);
    for (const product of PRODUCT_ORDER) {
        console.log(`\n${PRODUCT_NAMES[product]}`);
        for (const result of results.filter((r) => r.product === product)) {
            const value =
                result.value === null ? "" : String(result.value).slice(0, 60);
            console.log(
                `  ${STATUS_MARK[result.status]}${headerFor(layout, result.metric, period).padEnd(30)} ${value.padEnd(22)} ${result.status === "ok" ? "" : result.provenance}`
            );
        }
    }
    const errors = results.filter((r) => r.status === "error");
    const manual = results.filter((r) => r.status === "manual");
    console.log(
        `\n${results.filter((r) => r.status === "ok").length} collected, ${manual.length} need a human (M), ${errors.length} errored (!), ${results.filter((r) => r.status === "unavailable").length} not applicable (-).`
    );
};

const main = async (): Promise<void> => {
    const flags = parseArgs(process.argv.slice(2));
    if (flags.help || Object.keys(flags).length === 0) {
        console.log(USAGE);
        return;
    }

    if (flags.check) {
        const gaps = findUnconfiguredSources();
        console.log(
            gaps.length === 0
                ? "All sources configured."
                : `Unconfigured sources:\n  ${gaps.join("\n  ")}`
        );
        return;
    }

    const layout = await loadDashboardLayout("config/dashboard-columns.json");

    // Re-printing a saved run costs nothing, where collecting afresh means
    // several minutes of Mixpanel export -- worth having when only the output
    // format is in question.
    let period: Period;
    let results: MetricResult[];
    if (typeof flags["from-json"] === "string") {
        const saved = JSON.parse(
            await readFile(flags["from-json"], "utf8")
        ) as { period: Period; results: MetricResult[] };
        // Runs saved before periods carried a slug still need a file name.
        period = {
            ...saved.period,
            slug: saved.period.slug ?? inferSlug(saved.period.from, saved.period.to),
        };
        results = saved.results;
        console.log(`Re-printing ${flags["from-json"]} (collected nothing).`);
    } else {
        period = resolvePeriod(flags);
        results = await collectAll(period);
    }
    // Fold in the values only a human can supply, so the paste grid is complete.
    const manual = await loadManualValues(period);
    if (manual.found) {
        const merged = applyManualValues(results, manual.values, manual.path);
        results = merged.results;
        console.log(
            `
Filled ${merged.applied} cell(s) from ${manual.path}.`
        );
        for (const clash of merged.ignored) {
            console.log(`  ignored, we collect this ourselves: ${clash}`);
        }
    } else {
        console.log(
            `
No hand-entered values at ${manual.path}; Supported FTE, Paid FTE and Bloom Editor's New Projects Started will be blank.`
        );
    }

    printResults(results, period, layout);

    if (typeof flags.compare === "string") {
        const known = await loadKnownGood(flags.compare);
        reportComparison(results, known, layout, period);
    }

    const outDir = typeof flags.out === "string" ? flags.out : "output";
    const written = await writeQuarterFiles(outDir, period, results, layout);
    console.log(
        `\nWrote\n  ${written.pastePath}\n  ${written.reportPath}\n  ${written.runPath}`
    );
    if (written.anchor) {
        console.log(
            `\nOpen the .tsv, select all, copy, and paste into the dashboard at cell ${written.anchor}.`
        );
        if (written.gaps.length > 0) {
            console.log(
                `${written.gaps.length} cell(s) in that grid are blank and need filling in by hand; the report lists them.`
            );
        }
    }

    if (flags.paste) {
        const block = buildFullPasteBlock(
            results,
            layout,
            PRODUCT_ORDER,
            period
        );
        if (!block) {
            console.log("\nNo paste grid: nothing was collected.");
        } else {
            console.log(
                `\n=== the same grid, for a quick look (paste at ${block.anchor}) ===`
            );
            console.log(block.columns.map((c) => c.header).join("\t"));
            console.log(block.tsv);
        }
    }
};

main().catch((error) => {
    console.error(`\nFailed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
});
