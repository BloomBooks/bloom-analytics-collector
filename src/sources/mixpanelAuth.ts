import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { MixpanelProjectKey } from "../types.js";

/** Env var that can override each project's id, for a one-off run. */
const PROJECT_ID_ENV: Record<MixpanelProjectKey, string> = {
    bloomEditor: "MIXPANEL_PROJECT_ID_BLOOM_EDITOR",
    bloomReaderRelease: "MIXPANEL_PROJECT_ID_BLOOM_READER_RELEASE",
    bloomLibrary: "MIXPANEL_PROJECT_ID_BLOOM_LIBRARY",
};

interface ProjectConfigEntry {
    projectId: string | null;
    viewId?: string | null;
    boardId?: string | null;
}

const projectConfigPath = fileURLToPath(
    new URL("../../config/mixpanel-projects.json", import.meta.url)
);

let projectConfig: Record<string, ProjectConfigEntry> | undefined;

/**
 * The numeric project id, from config/mixpanel-projects.json unless an env var
 * overrides it. Project ids are not secrets, so they are committed; only the
 * service-account credentials live in .env.
 */
export const mixpanelProjectId = (project: MixpanelProjectKey): string => {
    const override = process.env[PROJECT_ID_ENV[project]];
    if (override) return override;

    if (!projectConfig) {
        projectConfig = JSON.parse(
            readFileSync(projectConfigPath, "utf8")
        ) as Record<string, ProjectConfigEntry>;
    }
    const id = projectConfig[project]?.projectId;
    if (!id) {
        throw new Error(
            `No Mixpanel project id for "${project}". Add it to config/mixpanel-projects.json (or set ${PROJECT_ID_ENV[project]}).`
        );
    }
    return id;
};

/**
 * Basic-auth header for a Mixpanel service account. Service accounts are
 * per-organization and are the only supported way to script Mixpanel.
 */
export const mixpanelAuthHeader = (): string => {
    const user = process.env.MIXPANEL_SERVICE_ACCOUNT_USER;
    const secret = process.env.MIXPANEL_SERVICE_ACCOUNT_SECRET;
    if (!user || !secret) {
        throw new Error(
            "Missing MIXPANEL_SERVICE_ACCOUNT_USER / _SECRET. See .env.example."
        );
    }
    return `Basic ${Buffer.from(`${user}:${secret}`).toString("base64")}`;
};
