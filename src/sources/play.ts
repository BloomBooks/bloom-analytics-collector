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

/** Minimal CSV split; Play's install overview files have no quoted commas. */
const parseCsv = (text: string): Record<string, string>[] => {
    const lines = text
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0);
    const header = lines[0]?.split(",").map((cell) => cell.trim()) ?? [];
    return lines.slice(1).map((line) => {
        const cells = line.split(",");
        const row: Record<string, string> = {};
        header.forEach((name, index) => {
            row[name] = (cells[index] ?? "").trim();
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

/**
 * Sums installs for one app over the reporting period, reading one monthly
 * overview CSV per month the period touches.
 */
export const getPlayInstalls = async (
    packageName: string,
    period: Period
): Promise<{ total: number; provenance: string }> => {
    let total = 0;
    const monthDetails: string[] = [];
    let lastSource = "";
    for (const yearMonth of monthsInPeriod(period)) {
        const { buffer, source } = await fetchMonthCsv(packageName, yearMonth);
        lastSource = source;
        const rows = parseCsv(decodeCsv(buffer));
        if (rows.length > 0 && !(INSTALL_COLUMN in rows[0]!)) {
            throw new Error(
                `Column "${INSTALL_COLUMN}" not found in ${source}. Available columns: ${Object.keys(rows[0]!).join(", ")}`
            );
        }
        // Rows are daily; the period always covers whole months, so summing every
        // row of each month's file gives the period total.
        const monthTotal = rows.reduce(
            (sum, row) => sum + Number(row[INSTALL_COLUMN] || 0),
            0
        );
        total += monthTotal;
        monthDetails.push(`${yearMonth}=${monthTotal}`);
    }

    return {
        total,
        provenance: `Play bulk reports, ${lastSource}, column "${INSTALL_COLUMN}" (${monthDetails.join(", ")})`,
    };
};
