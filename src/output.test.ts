import { describe, expect, it } from "vitest";
import { buildFullPasteBlock, columnIndex, columnLetter } from "./output.js";
import type { DashboardLayout } from "./output.js";
import type { MetricResult, Period, ProductId } from "./types.js";

describe("column letters", () => {
    it("round-trips single and double letters", () => {
        expect(columnLetter(0)).toBe("A");
        expect(columnLetter(25)).toBe("Z");
        expect(columnLetter(26)).toBe("AA");
        expect(columnLetter(27)).toBe("AB");
        for (const letter of ["A", "C", "Z", "AA", "AB", "BZ"]) {
            expect(columnLetter(columnIndex(letter))).toBe(letter);
        }
    });
});

const PERIOD: Period = {
    from: "2026-04-01",
    to: "2026-06-30",
    label: "FY26 Q3 (Apr-Jun 2026)",
    slug: "FY26Q3",
};

const ALL_PRODUCTS: ProductId[] = [
    "bloomEditor",
    "bloomLibrary",
    "bloomReader",
    "bloomPubViewer",
];

const layout: DashboardLayout = {
    startColumn: "A",
    // A: product name (never written), B: hand-entered, C-E: collected.
    columns: [null, null, "numberOfReleases", "installs", "activeUsers"],
    headers: ["Product Name", "Paid FTE", "Releases", "Installs", "Users"],
    productRows: {
        bloomEditor: 4,
        bloomLibrary: 5,
        bloomReader: 6,
        bloomPubViewer: 7,
    },
};

const ok = (
    product: ProductId,
    metric: MetricResult["metric"],
    value: string | number
): MetricResult => ({ product, metric, value, status: "ok", provenance: "t" });

describe("buildFullPasteBlock", () => {
    it("spans from the first to the last collected column, blanking the gaps", () => {
        const block = buildFullPasteBlock(
            [
                ok("bloomEditor", "numberOfReleases", 4),
                ok("bloomEditor", "activeUsers", 2245),
                ok("bloomLibrary", "activeUsers", 31536),
            ],
            layout,
            ALL_PRODUCTS,
            PERIOD
        );
        expect(block).not.toBeNull();
        // Starts at C, the first collected column -- not at A or B, which the
        // tool must never overwrite.
        expect(block!.anchor).toBe("C4");
        expect(block!.tsv.split("\n")).toEqual([
            "4\t\t2245",
            "\t\t31536",
            "\t\t",
            "\t\t",
        ]);
    });

    it("labels each column and marks which ones carry any value", () => {
        const block = buildFullPasteBlock(
            [ok("bloomEditor", "numberOfReleases", 4)],
            layout,
            ALL_PRODUCTS,
            PERIOD
        );
        expect(block!.columns.map((c) => c.header)).toEqual(["Releases"]);
        expect(block!.columns.map((c) => c.filled)).toEqual([true]);
    });

    it("returns null when nothing was collected", () => {
        expect(
            buildFullPasteBlock([], layout, ALL_PRODUCTS, PERIOD)
        ).toBeNull();
    });

    it("returns null when the product rows are not consecutive", () => {
        const gappy: DashboardLayout = {
            ...layout,
            productRows: {
                bloomEditor: 4,
                bloomLibrary: 5,
                bloomReader: 9,
                bloomPubViewer: 10,
            },
        };
        expect(
            buildFullPasteBlock(
                [ok("bloomEditor", "numberOfReleases", 4)],
                gappy,
                ALL_PRODUCTS,
                PERIOD
            )
        ).toBeNull();
    });
});
