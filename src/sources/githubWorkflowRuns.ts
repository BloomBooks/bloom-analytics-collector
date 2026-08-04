import type { Period, ReleaseField } from "../types.js";
import { githubHeaders } from "./github.js";

/**
 * Counts successful runs of a named GitHub Actions workflow, for products whose
 * "release" is a deploy rather than a versioned artifact.
 *
 * BloomLibrary.org is the case in point: the site has no version number and the
 * repo publishes no releases, but each production deploy is a run of the "Build
 * and Deploy" workflow. Counting its successful runs for Jan-Mar 2026 gives 41,
 * matching the hand-collected figure exactly (43 runs, 2 of them failed).
 */
interface WorkflowRun {
    created_at: string;
    conclusion: string | null;
    head_branch: string | null;
}

const findWorkflowId = async (
    repo: string,
    workflowName: string
): Promise<number> => {
    const response = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows?per_page=100`,
        { headers: githubHeaders() }
    );
    if (!response.ok) {
        throw new Error(
            `Listing workflows for ${repo} returned ${response.status}: ${(await response.text()).slice(0, 200)}`
        );
    }
    const data = (await response.json()) as {
        workflows?: { id: number; name: string }[];
    };
    const match = (data.workflows ?? []).find(
        (w) => w.name.toLowerCase() === workflowName.toLowerCase()
    );
    if (!match) {
        throw new Error(
            `No workflow named "${workflowName}" in ${repo}. Available: ${(data.workflows ?? []).map((w) => w.name).join(", ")}`
        );
    }
    return match.id;
};

/**
 * One fetch per repo, workflow and period for the life of a run. Bloom Library's
 * date and count columns both come from this list, so without the cache it was
 * paginated twice -- the same waste already removed from the release, tag and
 * installer listings.
 */
const runCache = new Map<string, Promise<WorkflowRun[]>>();

/**
 * Successful runs of the workflow created within the period. Runs on every branch
 * count: BloomLibrary2 deploys from master, release and embed, and counting all
 * of them is what reproduces the hand-collected number.
 */
const runsInPeriod = (
    repo: string,
    workflowName: string,
    period: Period
): Promise<WorkflowRun[]> => {
    const key = `${repo}|${workflowName}|${period.from}|${period.to}`;
    const cached = runCache.get(key);
    if (cached) return cached;
    const pending = fetchRunsInPeriod(repo, workflowName, period);
    runCache.set(key, pending);
    return pending;
};

const fetchRunsInPeriod = async (
    repo: string,
    workflowName: string,
    period: Period
): Promise<WorkflowRun[]> => {
    const workflowId = await findWorkflowId(repo, workflowName);
    const runs: WorkflowRun[] = [];
    for (let page = 1; page <= 10; page++) {
        const response = await fetch(
            `https://api.github.com/repos/${repo}/actions/workflows/${workflowId}/runs?per_page=100&page=${page}&created=${period.from}..${period.to}`,
            { headers: githubHeaders() }
        );
        if (!response.ok) {
            throw new Error(
                `Listing runs of "${workflowName}" in ${repo} returned ${response.status}: ${(await response.text()).slice(0, 200)}`
            );
        }
        const data = (await response.json()) as {
            workflow_runs?: WorkflowRun[];
        };
        // Deliberately not `?? []`. A reply that did not carry the list ended the
        // pagination loop with no runs, and zero deploys is a perfectly ordinary
        // number -- it would have been written to the dashboard as a collected
        // figure for a quarter that actually had forty.
        if (!Array.isArray(data.workflow_runs)) {
            throw new Error(
                `Listing runs of "${workflowName}" in ${repo} returned a reply with no workflow_runs list, so the deploy count would be understated rather than wrong-looking.`
            );
        }
        const batch = data.workflow_runs;
        runs.push(...batch);
        if (batch.length < 100) break;
    }
    // Filter by date locally as well as in the query. The `created=` parameter is
    // the server's interpretation of the range; re-checking here means the count
    // matches the period this tool defines, whatever the API decides at the
    // boundaries.
    return runs
        .filter((run) => {
            if (run.conclusion !== "success") return false;
            const day = (run.created_at ?? "").slice(0, 10);
            return day >= period.from && day <= period.to;
        })
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
};

/**
 * The count or latest date of successful workflow runs in the period. There is no
 * version to report for a deploy, so `want: "version"` is not supported.
 */
export const getWorkflowRunField = async (
    repo: string,
    workflowName: string,
    want: ReleaseField,
    period: Period
): Promise<{ value: string | number | null; provenance: string }> => {
    if (want === "version") {
        throw new Error(
            `A workflow deploy has no version number; do not use github-workflow-runs for a version column.`
        );
    }
    const successful = await runsInPeriod(repo, workflowName, period);

    if (want === "count") {
        return {
            value: successful.length,
            provenance: `${successful.length} successful "${workflowName}" runs in ${repo}, ${period.from}..${period.to}`,
        };
    }
    if (successful.length === 0) {
        return {
            value: null,
            provenance: `No successful "${workflowName}" runs in ${repo} for ${period.from}..${period.to}`,
        };
    }
    const latest = successful[successful.length - 1]!;
    return {
        value: latest.created_at.slice(0, 10),
        provenance: `last successful "${workflowName}" run in ${repo} within the period`,
    };
};
