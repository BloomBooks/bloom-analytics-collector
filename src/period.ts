import type { Period } from "./types.js";

/**
 * The calendar month (1-12) in which the fiscal year starts. October, confirmed
 * against a known-good quarter: FY26 Q3 is Apr-Jun 2026, so Q1 is Oct-Dec 2025
 * and the Dec 20 reporting deadline falls at the end of Q1.
 */
const FISCAL_YEAR_START_MONTH = 10;

const MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];

const isoDate = (year: number, month: number, day: number): string =>
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const lastDayOfMonth = (year: number, month: number): number =>
    new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Builds a Period from a fiscal quarter (`FY26Q3`). Throws on anything else -- we
 * would rather fail than silently report the wrong three months.
 *
 * Fiscal naming only, because that is what the dashboard uses and the two schemes
 * collide: `2026Q2` and `FY26Q2` are different quarters (Apr-Jun against Jan-Mar),
 * so the same "Q2" means one thing on the sheet and another in a calendar. This
 * used to accept both, which made asking for the wrong three months a typo away
 * and the result indistinguishable from the right one. A calendar quarter is now
 * refused, but the error names the fiscal quarter meant -- refusing is only
 * defensible if it tells you the answer.
 */
export const parseQuarter = (spec: string): Period => {
    const fiscal = /^FY(\d{2})Q([1-4])$/i.exec(spec);
    if (fiscal) {
        const fyShort = Number(fiscal[1]);
        const quarter = Number(fiscal[2]);
        // FY26 ends in calendar 2026, so it starts in calendar 2025.
        const fyEndYear = 2000 + fyShort;
        const startMonthAbsolute =
            (fyEndYear - 1) * 12 +
            (FISCAL_YEAR_START_MONTH - 1) +
            (quarter - 1) * 3;
        return quarterFromAbsoluteMonth(
            startMonthAbsolute,
            `FY${fyShort} Q${quarter}`,
            `FY${fyShort}Q${quarter}`
        );
    }

    const calendar = /^(\d{4})Q([1-4])$/.exec(spec);
    if (calendar) {
        const year = Number(calendar[1]);
        const quarter = Number(calendar[2]);
        const startMonthAbsolute = year * 12 + (quarter - 1) * 3;
        const period = quarterFromAbsoluteMonth(startMonthAbsolute, spec, spec);
        throw new Error(
            `"${spec}" is a calendar quarter, and this project names quarters the way the dashboard does. ${period.from} to ${period.to} is ${inferSlug(period.from, period.to)} -- ask for that instead, or pass --from and --to.`
        );
    }

    throw new Error(
        `Unrecognised quarter "${spec}". Use a fiscal quarter like FY26Q3, or pass --from and --to.`
    );
};

/** Turns a months-since-year-0 index into a three-month inclusive Period. */
const quarterFromAbsoluteMonth = (
    startMonthAbsolute: number,
    labelPrefix: string,
    slug: string
): Period => {
    const startYear = Math.floor(startMonthAbsolute / 12);
    const startMonth = (startMonthAbsolute % 12) + 1;
    const endMonthAbsolute = startMonthAbsolute + 2;
    const endYear = Math.floor(endMonthAbsolute / 12);
    const endMonth = (endMonthAbsolute % 12) + 1;

    const from = isoDate(startYear, startMonth, 1);
    const to = isoDate(endYear, endMonth, lastDayOfMonth(endYear, endMonth));
    const span =
        startYear === endYear
            ? `${MONTH_NAMES[startMonth - 1]}-${MONTH_NAMES[endMonth - 1]} ${startYear}`
            : `${MONTH_NAMES[startMonth - 1]} ${startYear}-${MONTH_NAMES[endMonth - 1]} ${endYear}`;
    return { from, to, label: `${labelPrefix} (${span})`, slug };
};

/**
 * The fiscal-quarter name for a date range, if it is exactly one -- so that
 * `--from 2026-04-01 --to 2026-06-30` still produces files called FY26Q3, and a
 * run saved before slugs existed can be renamed from its dates alone.
 * Falls back to `from_to` for any range that is not a whole fiscal quarter.
 */
export const inferSlug = (from: string, to: string): string => {
    const [fromYear, fromMonth] = from.split("-").map(Number) as [
        number,
        number,
    ];
    const startsQuarter = (fromMonth - FISCAL_YEAR_START_MONTH + 12) % 3 === 0;
    if (startsQuarter && from.endsWith("-01")) {
        const quarter =
            ((((fromMonth - FISCAL_YEAR_START_MONTH + 12) % 12) / 3) | 0) + 1;
        // A fiscal year is named for the calendar year it ends in, so the months
        // from October onwards belong to the next one.
        const fiscalYear =
            fromMonth >= FISCAL_YEAR_START_MONTH ? fromYear + 1 : fromYear;
        const candidate = `FY${String(fiscalYear).slice(2)}Q${quarter}`;
        const period = parseQuarter(candidate);
        if (period.from === from && period.to === to) return candidate;
    }
    return `${from}_${to}`;
};

/** Builds a Period from explicit ISO dates, validating their shape and order. */
export const periodFromDates = (from: string, to: string): Period => {
    for (const date of [from, to]) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            throw new Error(`Date "${date}" is not in YYYY-MM-DD form.`);
        }
    }
    if (from > to) {
        throw new Error(`--from (${from}) is after --to (${to}).`);
    }
    return { from, to, label: `${from} to ${to}`, slug: inferSlug(from, to) };
};

/**
 * Short month names for the period, e.g. ["Jan", "Feb", "Mar"]. The dashboard's
 * MAU columns are named for the quarter's months, so output has to label them
 * from the period being collected rather than from the recorded header text --
 * otherwise a Jan-Mar run prints last quarter's month names.
 */
export const monthLabelsInPeriod = (period: Period): string[] =>
    monthsInPeriod(period).map(
        (yearMonth) => MONTH_NAMES[Number(yearMonth.slice(4)) - 1]!
    );

/**
 * Every calendar month the period touches, as `YYYYMM` strings. Used by the
 * Play Console collector, whose bulk reports are one file per month.
 */
export const monthsInPeriod = (period: Period): string[] => {
    const [fromYear, fromMonth] = period.from.split("-").map(Number) as [
        number,
        number,
    ];
    const [toYear, toMonth] = period.to.split("-").map(Number) as [
        number,
        number,
    ];
    const months: string[] = [];
    for (
        let absolute = fromYear * 12 + (fromMonth - 1);
        absolute <= toYear * 12 + (toMonth - 1);
        absolute++
    ) {
        const year = Math.floor(absolute / 12);
        const month = (absolute % 12) + 1;
        months.push(`${year}${String(month).padStart(2, "0")}`);
    }
    return months;
};
