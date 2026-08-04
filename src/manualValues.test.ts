import { describe, expect, it } from "vitest";
import { applyManualValues } from "./manualValues.js";
import type { MetricResult } from "./types.js";

const result = (
    status: MetricResult["status"],
    provenance: string
): MetricResult => ({
    product: "bloomReader",
    metric: "installs",
    value: null,
    status,
    provenance,
});

describe("applyManualValues", () => {
    it("fills a cell that is waiting for a human", () => {
        const out = applyManualValues(
            [result("manual", "look it up in Play Console")],
            { bloomReader: { installs: 3363 } },
            "config/manual/X.json"
        );
        expect(out.applied).toBe(1);
        expect(out.results[0]!.value).toBe(3363);
        expect(out.results[0]!.status).toBe("ok");
    });

    it("does NOT mask a source that failed this run", () => {
        // Otherwise a stale hand-entered figure hides a 403 from the Play bucket,
        // and the run looks complete when a number is simply missing.
        const out = applyManualValues(
            [result("error", "403 from the bulk-reports bucket")],
            { bloomReader: { installs: 3363 } },
            "config/manual/X.json"
        );
        expect(out.applied).toBe(0);
        expect(out.results[0]!.status).toBe("error");
        expect(out.results[0]!.value).toBeNull();
        expect(out.refused.join(" ")).toContain("not filled");
    });

    it("does not fill a column that does not apply to the product", () => {
        const out = applyManualValues(
            [result("unavailable", "n/a for the website")],
            { bloomReader: { installs: 999 } },
            "config/manual/X.json"
        );
        expect(out.applied).toBe(0);
        expect(out.results[0]!.status).toBe("unavailable");
        // A column that does not apply is a stray entry in the file, not a broken
        // source. It briefly shared the failure list, which meant the run announced
        // that a data source had died when nothing at all had gone wrong.
        expect(out.notApplicable).toHaveLength(1);
        expect(out.refused).toHaveLength(0);
    });

    it("still refuses to overwrite an automatically collected value", () => {
        const collected: MetricResult = {
            ...result("ok", "Play bulk reports"),
            value: 2446,
        };
        const out = applyManualValues(
            [collected],
            { bloomReader: { installs: 3363 } },
            "config/manual/X.json"
        );
        expect(out.results[0]!.value).toBe(2446);
        expect(out.superseded.join(" ")).toContain("a source collected this");
    });

    it("keeps a failed source apart from one that simply won the tie", () => {
        // These went into one list, and the CLI printed that list under "we collect
        // this ourselves" -- so a failed Play download was announced as a success and
        // the blank cell was left for someone to notice unaided. They are different
        // events and have to stay separable.
        const failed: MetricResult = {
            ...result("error", "403 from the bulk-reports bucket"),
            product: "bloomReader",
        };
        const collected: MetricResult = {
            ...result("ok", "Play bulk reports"),
            product: "bloomEditor",
            value: 673,
        };
        const out = applyManualValues(
            [failed, collected],
            {
                bloomReader: { installs: 3363 },
                bloomEditor: { installs: 999 },
            },
            "config/manual/X.json"
        );
        expect(out.applied).toBe(0);
        expect(out.refused).toHaveLength(1);
        expect(out.superseded).toHaveLength(1);
        expect(out.refused.join(" ")).toContain("bloomReader");
        expect(out.superseded.join(" ")).toContain("bloomEditor");
        // Sanity check that the failed one really is the refused one, rather than
        // the two lists simply having one entry each by luck.
        expect(out.refused.join(" ")).not.toContain("bloomEditor");
    });
});

describe("replaying a saved run", () => {
    it("re-reads a corrected hand-entered value instead of keeping the old one", () => {
        // Regression: a value persisted as ok-because-a-person-typed-it used to be
        // treated as "a source produced this", so fixing the manual file and
        // replaying with --from-json silently kept the wrong number.
        const saved: MetricResult = {
            product: "bloomEditor",
            metric: "newProjectsStarted",
            value: 188,
            status: "ok",
            provenance: "hand-entered in config/manual/FY26Q3.json",
        };
        const out = applyManualValues(
            [saved],
            { bloomEditor: { newProjectsStarted: 201 } },
            "config/manual/FY26Q3.json"
        );
        expect(out.results[0]!.value).toBe(201);
        expect(out.applied).toBe(1);
    });

    it("still will not overwrite a value a source produced", () => {
        const collected: MetricResult = {
            product: "bloomEditor",
            metric: "installs",
            value: 673,
            status: "ok",
            provenance: "Mixpanel raw export, bloomEditor [all], installs",
        };
        const out = applyManualValues(
            [collected],
            { bloomEditor: { installs: 999 } },
            "config/manual/FY26Q3.json"
        );
        expect(out.results[0]!.value).toBe(673);
        expect(out.superseded.join(" ")).toContain("a source collected this");
    });
});
