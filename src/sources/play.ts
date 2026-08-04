import { Storage } from "@google-cloud/storage";
import { monthsInPeriod } from "../period.js";
import type { Period } from "../types.js";

/**
 * Google Play install numbers come from the Play Console's "bulk reports",
 * which the console writes as CSVs into a Cloud Storage bucket named
 * `pubsite_prod_<developerAccountId>`. That bucket id is shown in the Play
 * Console under Download reports -> (any report) -> Copy Cloud Storage URI.
 *
 * We use the bulk reports rather than the Play Developer Reporting API because
 * that API has no installs metric set at all -- it covers vitals only.
 */
const bucketName = (): string => {
    const bucket = process.env.PLAY_REPORTS_BUCKET;
    if (!bucket) {
        throw new Error(
            "Missing PLAY_REPORTS_BUCKET (e.g. pubsite_prod_1234567890). See .env.example."
        );
    }
    return bucket.replace(/^gs:\/\//, "").split("/")[0]!;
};

/**
 * The CSV column to sum. "Daily Device Installs" is Play's uniques-based measure --
 * the one Google's statistics report calls "Device acquisition > New devices" --
 * which is what the dashboard's "Unique first-run" definition asks for. The
 * events-based alternatives ("Install events", "All device acquisitions" in the UI)
 * count re-installs and run 55-63% higher; the figures recorded for FY26Q1 and
 * FY26Q2 came from those by mistake.
 *
 * Verified month by month against the UI's New devices report for Jan-Jun 2026.
 */
const INSTALL_COLUMN =
    process.env.PLAY_INSTALL_COLUMN ?? "Daily Device Installs";

/**
 * Play's bulk report CSVs are UTF-16LE with a BOM, not UTF-8. Decoding them as
 * UTF-8 yields garbage that still "parses", so this is not optional.
 */
const decodeCsv = (buffer: Buffer): string => {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
        return buffer.subarray(2).toString("utf16le");
    }
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return buffer.subarray(3).toString("utf8");
    }
    return buffer.toString("utf8");
};

/**
 * Minimal CSV split; Play's install overview files have no quoted commas.
 *
 * A row with fewer cells than the header is rejected here rather than padded.
 * Padding with "" made a truncated row indistinguishable from one full of genuine
 * zeros, so a cut-off file quietly understated the month -- and it made the
 * absent-cell check further down unreachable, which is how that hid.
 */
const parseCsv = (
    text: string,
    source: string
): Record<string, string>[] => {
    const lines = text
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0);
    const header = lines[0]?.split(",").map((cell) => cell.trim()) ?? [];
    return lines.slice(1).map((line, lineIndex) => {
        const cells = line.split(",");
        if (cells.length !== header.length) {
            throw new Error(
                `${source} line ${lineIndex + 2} has ${cells.length} cells but the header has ${header.length}, so the row is truncated or malformed.`
            );
        }
        const row: Record<string, string> = {};
        header.forEach((name, index) => {
            row[name] = cells[index]!.trim();
        });
        return row;
    });
};

/** The bucket object name for a month's install overview. */
const overviewObjectPath = (packageName: string, yearMonth: string): string =>
    `stats/installs/installs_${packageName}_${yearMonth}_overview.csv`;

/** Downloads one month's install overview CSV from the bulk-reports bucket. */
const fetchMonthCsv = async (
    packageName: string,
    yearMonth: string
): Promise<{ buffer: Buffer; source: string }> => {
    const storage = new Storage({
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
    const objectPath = overviewObjectPath(packageName, yearMonth);
    const [buffer] = await storage
        .bucket(bucketName())
        .file(objectPath)
        .download();
    // The object name, not the bucket URI: the bucket name embeds the Play
    // developer account id and this string ends up in a committed file.
    return { buffer, source: objectPath };
};

/** The last day of the month a `YYYY-MM-DD` date falls in. */
const lastDayOfMonth = (date: string): string => {
    const [year, month] = date.split("-").map(Number) as [number, number];
    const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

/**
 * Checks that a month's report describes that month completely: one row per day,
 * each day present exactly once, and no dates from another month.
 *
 * Without this, three different kinds of bad file all produced a plausible number.
 * A file truncated after a few rows passed the has-any-rows check and undercounted.
 * A duplicated date overcounted. A row from a neighbouring month counted days
 * outside the period. Every one of them would have been written to the dashboard
 * as a successfully collected figure.
 */
const daysCoveredExactlyOnce = (
    rows: Record<string, string>[],
    yearMonth: string,
    source: string
): void => {
    const year = Number(yearMonth.slice(0, 4));
    const month = Number(yearMonth.slice(4));
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const prefix = `${year}-${String(month).padStart(2, "0")}`;

    // Match against the actual days of the month, not just the "YYYY-MM" prefix.
    // A prefix test accepts an impossible date like 2026-04-00 or 2026-04-31, and
    // one of those standing in for a real day would satisfy both the prefix and
    // the row count while the real day's installs went missing.
    const expected = new Set(
        Array.from(
            { length: daysInMonth },
            (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`
        )
    );

    const seen = new Set<string>();
    for (const row of rows) {
        const date = (row["Date"] ?? "").trim();
        if (!expected.has(date)) {
            throw new Error(
                `${source} contains a row dated ${JSON.stringify(date)}, which is not a real day in ${prefix}.`
            );
        }
        if (seen.has(date)) {
            throw new Error(
                `${source} lists ${date} more than once, which would count that day's installs twice.`
            );
        }
        seen.add(date);
    }
    if (seen.size !== daysInMonth) {
        const missing = [...expected].filter((d) => !seen.has(d));
        throw new Error(
            `${source} is missing ${missing.length} of the ${daysInMonth} days in ${prefix} (first: ${missing[0]}), so the total would be understated.`
        );
    }
};

/**
 * One row's install count, refusing any value that cannot be one.
 *
 * An empty cell is a genuine zero in Play's reports. Anything else has to be a
 * whole, non-negative number, and each way of not being one fails quietly if it is
 * not caught here: a non-numeric cell becomes NaN through Number() and NaN spreads
 * through the sum to be written out as the total, while "-1" or "1.5" would simply
 * be added and published as a collected figure.
 */
const installCount = (row: Record<string, string>, source: string): number => {
    // The cell is known to exist, because parseCsv rejects rows shorter than the
    // header rather than padding them.
    const raw = row[INSTALL_COLUMN]!;
    const value = raw.trim() === "" ? 0 : Number(raw);
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(
            `${source} has an unusable "${INSTALL_COLUMN}" of ${JSON.stringify(raw)} on the row for ${row["Date"] ?? "an unknown date"} -- an install count must be a whole number and cannot be negative.`
        );
    }
    return value;
};

/**
 * Refuses a period that does not cover whole calendar months.
 *
 * Play publishes one file per month and we sum every daily row in it, so a range
 * starting or ending mid-month would quietly include days outside the period.
 * Every real reporting period is a quarter, so this never fires in normal use --
 * it exists so that an unusual `--from`/`--to` fails instead of over-counting.
 */
const wholeMonthsOnly = (period: Period): void => {
    if (
        !period.from.endsWith("-01") ||
        period.to !== lastDayOfMonth(period.to)
    ) {
        throw new Error(
            `Play installs can only be summed over whole calendar months, but the period is ${period.from}..${period.to}. Use a quarter, or a range from the 1st to a month end.`
        );
    }
};

/**
 * Sums installs for one app over the reporting period, reading one monthly
 * overview CSV per month the period touches.
 */
export const getPlayInstalls = async (
    packageName: string,
    period: Period
): Promise<{ total: number; provenance: string }> => {
    wholeMonthsOnly(period);

    let total = 0;
    const monthDetails: string[] = [];
    // Every month's file, not just the last one. The total is a sum across one file
    // per month, so naming a single file sent anyone auditing the figure to a file
    // that could only account for a third of it.
    const sources: string[] = [];
    for (const yearMonth of monthsInPeriod(period)) {
        const { buffer, source } = await fetchMonthCsv(packageName, yearMonth);
        sources.push(source);
        const rows = parseCsv(decodeCsv(buffer), source);
        // An empty report is not a zero-install month -- it means the download
        // was truncated or the file is not what we think it is. Fail rather than
        // fold a silent 0 into the total.
        if (rows.length === 0) {
            throw new Error(
                `${source} has no data rows. A month with no installs still has one row per day, so this is a bad or truncated file.`
            );
        }
        daysCoveredExactlyOnce(rows, yearMonth, source);
        if (!(INSTALL_COLUMN in rows[0]!)) {
            throw new Error(
                `Column "${INSTALL_COLUMN}" not found in ${source}. Available columns: ${Object.keys(rows[0]!).join(", ")}`
            );
        }
        // Rows are daily, and the guard above has established that the period
        // covers whole months, so summing every row of each file is the total.
        let monthTotal = 0;
        for (const row of rows) {
            monthTotal += installCount(row, source);
        }
        total += monthTotal;
        monthDetails.push(`${yearMonth}=${monthTotal}`);
    }

    return {
        total,
        provenance: `Play bulk reports, column "${INSTALL_COLUMN}", summing ${sources.join(" + ")} (${monthDetails.join(", ")})`,
    };
};

/** Exposed for unit tests only. */
export const wholeMonthsOnlyForTest = wholeMonthsOnly;
/** Exposed for unit tests only. */
export const parseCsvForTest = (text: string, source = "test.csv") =>
    parseCsv(text, source);

/** Exposed for unit tests only. */
export const daysCoveredExactlyOnceForTest = daysCoveredExactlyOnce;
/** Exposed for unit tests only. */
export const installCountForTest = installCount;
