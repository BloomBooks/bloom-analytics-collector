import { describe, expect, it } from "vitest";
import {
    inferSlug,
    monthLabelsInPeriod,
    monthsInPeriod,
    parseQuarter,
    periodFromDates,
} from "./period.js";

describe("parseQuarter", () => {
    it("maps a calendar quarter to its three months", () => {
        const period = parseQuarter("2025Q4");
        expect(period.from).toBe("2025-10-01");
        expect(period.to).toBe("2025-12-31");
    });

    it("maps FY26Q1 to Oct-Dec 2025 (October fiscal-year start)", () => {
        const period = parseQuarter("FY26Q1");
        expect(period.from).toBe("2025-10-01");
        expect(period.to).toBe("2025-12-31");
    });

    it("maps FY26Q3 to Apr-Jun 2026 (confirmed against a real reporting quarter)", () => {
        const period = parseQuarter("FY26Q3");
        expect(period.from).toBe("2026-04-01");
        expect(period.to).toBe("2026-06-30");
    });

    it("maps FY26Q4 to the quarter ending with the fiscal year", () => {
        const period = parseQuarter("FY26Q4");
        expect(period.from).toBe("2026-07-01");
        expect(period.to).toBe("2026-09-30");
    });

    it("ends a February quarter on the right day in a leap year", () => {
        // Sanity check: this quarter must actually end in February.
        const period = parseQuarter("2024Q1");
        expect(period.to.slice(0, 7)).toBe("2024-03");
        expect(parseQuarter("FY24Q2").to).toBe("2024-03-31");
    });

    it("rejects a period spec it does not understand rather than guessing", () => {
        expect(() => parseQuarter("Q1 2025")).toThrow(/Unrecognised quarter/);
        expect(() => parseQuarter("2025Q5")).toThrow(/Unrecognised quarter/);
    });
});

describe("periodFromDates", () => {
    it("rejects a backwards range", () => {
        expect(() => periodFromDates("2025-12-31", "2025-10-01")).toThrow(
            /is after/
        );
    });

    it("rejects a malformed date", () => {
        expect(() => periodFromDates("10/01/2025", "2025-12-31")).toThrow(
            /YYYY-MM-DD/
        );
    });
});

describe("monthsInPeriod", () => {
    it("lists every month a quarter touches", () => {
        expect(monthsInPeriod(parseQuarter("FY26Q1"))).toEqual([
            "202510",
            "202511",
            "202512",
        ]);
    });

    it("crosses a year boundary", () => {
        expect(
            monthsInPeriod(periodFromDates("2025-11-01", "2026-02-28"))
        ).toEqual(["202511", "202512", "202601", "202602"]);
    });

    it("returns a single month for a within-month range", () => {
        expect(
            monthsInPeriod(periodFromDates("2025-10-05", "2025-10-20"))
        ).toEqual(["202510"]);
    });
});

describe("monthLabelsInPeriod", () => {
    it("names the quarter's own months, not the layout's", () => {
        expect(monthLabelsInPeriod(parseQuarter("FY26Q2"))).toEqual([
            "Jan",
            "Feb",
            "Mar",
        ]);
        expect(monthLabelsInPeriod(parseQuarter("FY26Q3"))).toEqual([
            "Apr",
            "May",
            "Jun",
        ]);
    });

    it("crosses a year boundary in order", () => {
        expect(
            monthLabelsInPeriod(periodFromDates("2025-11-01", "2026-01-31"))
        ).toEqual(["Nov", "Dec", "Jan"]);
    });
});

describe("inferSlug", () => {
    it("names a whole fiscal quarter given only its dates", () => {
        expect(inferSlug("2026-04-01", "2026-06-30")).toBe("FY26Q3");
        expect(inferSlug("2025-10-01", "2025-12-31")).toBe("FY26Q1");
        expect(inferSlug("2026-01-01", "2026-03-31")).toBe("FY26Q2");
        expect(inferSlug("2026-07-01", "2026-09-30")).toBe("FY26Q4");
    });

    it("agrees with parseQuarter, which is the definition of correct here", () => {
        for (const spec of ["FY26Q1", "FY26Q2", "FY26Q3", "FY26Q4", "FY27Q1"]) {
            const period = parseQuarter(spec);
            expect(inferSlug(period.from, period.to)).toBe(spec);
        }
    });

    it("falls back to the dates for a range that is not a whole quarter", () => {
        expect(inferSlug("2026-04-01", "2026-05-31")).toBe(
            "2026-04-01_2026-05-31"
        );
        expect(inferSlug("2026-04-15", "2026-06-30")).toBe(
            "2026-04-15_2026-06-30"
        );
    });
});
