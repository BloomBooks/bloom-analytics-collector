import { describe, expect, it } from "vitest";
import {
    daysCoveredExactlyOnceForTest,
    installCountForTest,
    parseCsvForTest,
    wholeMonthsOnlyForTest,
} from "./play.js";
import { parseQuarter, periodFromDates } from "../period.js";

describe("whole-month guard", () => {
    it("accepts a quarter", () => {
        expect(() =>
            wholeMonthsOnlyForTest(parseQuarter("FY26Q3"))
        ).not.toThrow();
    });

    it("refuses a range starting mid-month", () => {
        // Play publishes one file per month and we sum every daily row, so a
        // partial range would quietly include days outside the period.
        expect(() =>
            wholeMonthsOnlyForTest(periodFromDates("2026-04-15", "2026-06-30"))
        ).toThrow(/whole calendar months/);
    });

    it("refuses a range ending mid-month", () => {
        expect(() =>
            wholeMonthsOnlyForTest(periodFromDates("2026-04-01", "2026-06-10"))
        ).toThrow(/whole calendar months/);
    });

    it("accepts a single whole month, including February", () => {
        expect(() =>
            wholeMonthsOnlyForTest(periodFromDates("2024-02-01", "2024-02-29"))
        ).not.toThrow();
        expect(() =>
            wholeMonthsOnlyForTest(periodFromDates("2024-02-01", "2024-02-28"))
        ).toThrow(/whole calendar months/);
    });
});

describe("parsing Play's install CSV", () => {
    const header = "Date,Package name,Daily Device Installs";

    it("reads the daily rows", () => {
        const rows = parseCsvForTest(
            `${header}\n2026-04-01,org.sil.bloom.reader,7\n2026-04-02,org.sil.bloom.reader,11\n`
        );
        expect(rows).toHaveLength(2);
        expect(rows[0]!["Daily Device Installs"]).toBe("7");
    });

    it("rejects a truncated row instead of padding it with zeros", () => {
        // This is where truncation was being erased: padding absent cells with ""
        // made a cut-off row look like a row of genuine zeros, and made the
        // absent-cell check further downstream unreachable.
        expect(() =>
            parseCsvForTest(`${header}
2026-04-01,org.sil.x
`)
        ).toThrow(/truncated or malformed/);
    });

    it("keeps Play's own column spelling", () => {
        // Play writes "Package name", not "Package Name" -- worth pinning, since
        // an exclusion list that guessed wrong produced NaN once.
        const rows = parseCsvForTest(`${header}\n2026-04-01,org.sil.x,7\n`);
        expect(Object.keys(rows[0]!)).toContain("Package name");
    });
});

describe("what counts as an install count", () => {
    const row = (value: string) => ({
        Date: "2026-04-01",
        "Daily Device Installs": value,
    });

    it("reads a whole number, and treats an empty cell as a genuine zero", () => {
        expect(installCountForTest(row("7"), "f.csv")).toBe(7);
        expect(installCountForTest(row(""), "f.csv")).toBe(0);
        expect(installCountForTest(row("0"), "f.csv")).toBe(0);
    });

    it("refuses a negative or fractional count", () => {
        // A count of devices cannot be either. Checking only that the number was
        // finite let both through into the sum, to be published as a collected
        // total -- understated by the negative, nonsense from the fraction.
        expect(() => installCountForTest(row("-1"), "f.csv")).toThrow(
            /whole number and cannot be negative/
        );
        expect(() => installCountForTest(row("1.5"), "f.csv")).toThrow(
            /whole number and cannot be negative/
        );
    });

    it("refuses anything that is not a number at all", () => {
        // Number() makes these NaN, and NaN spreads through the sum silently.
        expect(() => installCountForTest(row("n/a"), "f.csv")).toThrow();
        expect(() => installCountForTest(row("1,234"), "f.csv")).toThrow();
    });

    it("names the date in the error, so the bad row can be found", () => {
        expect(() => installCountForTest(row("-1"), "installs.csv")).toThrow(
            /2026-04-01/
        );
    });
});

describe("a month's report must cover that month", () => {
    const rowsFor = (dates: string[]) =>
        dates.map((d) => ({ Date: d, "Daily Device Installs": "1" }));
    const allOf = (yearMonth: string, days: number) =>
        rowsFor(
            Array.from(
                { length: days },
                (_, i) =>
                    `${yearMonth.slice(0, 4)}-${yearMonth.slice(4)}-${String(i + 1).padStart(2, "0")}`
            )
        );

    it("accepts a complete month", () => {
        expect(() =>
            daysCoveredExactlyOnceForTest(allOf("202604", 30), "202604", "f.csv")
        ).not.toThrow();
        // Sanity check that the helper really builds 30 distinct days.
        expect(allOf("202604", 30)).toHaveLength(30);
    });

    it("rejects a truncated file, which used to pass and understate the total", () => {
        expect(() =>
            daysCoveredExactlyOnceForTest(allOf("202604", 12), "202604", "f.csv")
        ).toThrow(/missing 18 of the 30 days/);
    });

    it("rejects a duplicated date, which would count a day twice", () => {
        const rows = allOf("202604", 30);
        rows[5] = { ...rows[4]! };
        expect(() =>
            daysCoveredExactlyOnceForTest(rows, "202604", "f.csv")
        ).toThrow(/more than once/);
    });

    it("rejects a date from another month", () => {
        const rows = allOf("202604", 30);
        rows[0] = { Date: "2026-03-31", "Daily Device Installs": "1" };
        expect(() =>
            daysCoveredExactlyOnceForTest(rows, "202604", "f.csv")
        ).toThrow(/not a real day in 2026-04/);
    });

    it("rejects an impossible day that shares the month prefix", () => {
        // The check used to be a prefix test, which "2026-04-00" satisfies. A row
        // like that standing in for a real day kept the count at 30 and the prefix
        // intact, so the month looked complete while a day's installs were gone.
        const rows = allOf("202604", 30);
        rows[9] = { Date: "2026-04-00", "Daily Device Installs": "1" };
        expect(() =>
            daysCoveredExactlyOnceForTest(rows, "202604", "f.csv")
        ).toThrow(/not a real day in 2026-04/);
        // Sanity check that the substitution kept the row count at a full month,
        // which is what let the old check pass.
        expect(rows).toHaveLength(30);
    });

    it("names a missing day when the file is short", () => {
        const rows = allOf("202604", 30).filter(
            (r) => r["Date"] !== "2026-04-07"
        );
        expect(() =>
            daysCoveredExactlyOnceForTest(rows, "202604", "f.csv")
        ).toThrow(/missing 1 of the 30 days in 2026-04 \(first: 2026-04-07\)/);
    });

    it("knows how long February is in a leap year", () => {
        expect(() =>
            daysCoveredExactlyOnceForTest(allOf("202402", 29), "202402", "f.csv")
        ).not.toThrow();
        expect(() =>
            daysCoveredExactlyOnceForTest(allOf("202502", 29), "202502", "f.csv")
        ).toThrow();
    });
});
