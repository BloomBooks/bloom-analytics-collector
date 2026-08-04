import { METRIC_ORDER, METRIC_SOURCES, PRODUCT_ORDER } from "./metrics.js";
import { getBloomReleaseField } from "./sources/bloomInstallers.js";
import { getGitHubReleaseField } from "./sources/github.js";
import { getTagReleaseField } from "./sources/githubTags.js";
import { getWorkflowRunField } from "./sources/githubWorkflowRuns.js";
import {
    getExportAggregate,
    measureFromAggregate,
} from "./sources/mixpanelExport.js";
import { getPlayInstalls } from "./sources/play.js";
import type { MetricId, MetricResult, Period, ProductId } from "./types.js";

/**
 * Collects one (product, metric) value. Any error is captured into the result
 * rather than thrown, so that one broken source does not abandon the other
 * forty-odd numbers -- but the failure is always reported, never silently
 * treated as zero or blank.
 */
const collectOne = async (
    product: ProductId,
    metric: MetricId,
    period: Period
): Promise<MetricResult> => {
    const source = METRIC_SOURCES[product][metric];
    if (!source) {
        return {
            product,
            metric,
            value: null,
            status: "unavailable",
            provenance: "No source defined for this product/metric.",
        };
    }

    try {
        switch (source.kind) {
            case "mixpanel-export": {
                const aggregate = await getExportAggregate(
                    source.project,
                    period
                );
                const value = measureFromAggregate(
                    aggregate,
                    source.bucket,
                    source.measure,
                    period
                );
                return {
                    product,
                    metric,
                    value,
                    status: "ok",
                    provenance: `Mixpanel raw export, ${source.project} [${source.bucket}], ${source.measure}; ${aggregate.totalEvents} events scanned${aggregate.skippedEvents > 0 ? `, ${aggregate.skippedEvents} skipped for having no user id or timestamp` : ""}`,
                };
            }

            case "play-installs": {
                const { total, provenance } = await getPlayInstalls(
                    source.packageName,
                    period
                );
                return {
                    product,
                    metric,
                    value: total,
                    status: "ok",
                    provenance,
                };
            }

            case "github-releases": {
                const { value, provenance } = await getGitHubReleaseField(
                    source.repo,
                    source.want,
                    period
                );
                return {
                    product,
                    metric,
                    value,
                    status: value === null ? "unavailable" : "ok",
                    provenance,
                };
            }

            case "github-tags": {
                const { value, provenance } = await getTagReleaseField(
                    source.repo,
                    source.want,
                    period
                );
                return {
                    product,
                    metric,
                    value,
                    status: value === null ? "unavailable" : "ok",
                    provenance,
                };
            }

            case "github-workflow-runs": {
                const { value, provenance } = await getWorkflowRunField(
                    source.repo,
                    source.workflow,
                    source.want,
                    period
                );
                return {
                    product,
                    metric,
                    value,
                    status: value === null ? "unavailable" : "ok",
                    provenance,
                };
            }

            case "bloom-installers": {
                const { value, provenance } = await getBloomReleaseField(
                    source.want,
                    period
                );
                return {
                    product,
                    metric,
                    value,
                    status: value === null ? "unavailable" : "ok",
                    provenance,
                };
            }

            case "manual":
                return {
                    product,
                    metric,
                    value: null,
                    status: "manual",
                    provenance: `Look it up: ${source.where}${source.note ? ` -- ${source.note}` : ""}`,
                };

            case "unavailable":
                return {
                    product,
                    metric,
                    value: null,
                    status: "unavailable",
                    provenance: source.reason,
                };
        }
    } catch (error) {
        return {
            product,
            metric,
            value: null,
            status: "error",
            provenance: error instanceof Error ? error.message : String(error),
        };
    }
};

/**
 * Collects every metric for every product over the period. Sources are queried
 * concurrently; each is independent.
 */
export const collectAll = async (period: Period): Promise<MetricResult[]> => {
    const jobs: Promise<MetricResult>[] = [];
    for (const product of PRODUCT_ORDER) {
        for (const metric of METRIC_ORDER) {
            jobs.push(collectOne(product, metric, period));
        }
    }
    return Promise.all(jobs);
};
