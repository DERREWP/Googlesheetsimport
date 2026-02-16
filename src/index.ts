import * as core from "@actions/core";
import { getPRInfo } from "./github";
import { syncToSheets } from "./sheets";

// Normalize environment names from various conventions to canonical form
export function normalizeEnvironment(env: string): string {
  const mapping: Record<string, string> = {
    internal: "internal",
    internaltest: "internal",
    int: "internal",
    stage: "stage",
    production: "production",
    prod: "production"
  };
  return mapping[env.toLowerCase()] ?? "";
}

async function run() {
  try {
    // 1. Get inputs
    const token = core.getInput("github-token", { required: true });
    const spreadsheetId = core.getInput("spreadsheet-id", { required: true });
    const googleCredentials = core.getInput("google-credentials", { required: true });
    const app = core.getInput("app", { required: true });
    const environmentRaw = core.getInput("environment", { required: true });
    const version = core.getInput("version") || "";
    const sheetName = core.getInput("sheet-name") || "Next";
    const jiraTickets = core.getInput("jira-tickets") || "";
    const baseTag = core.getInput("base-tag") || "";
    const headTag = core.getInput("head-tag") || "";
    const tagSuffix = core.getInput("tag-suffix") || "";
    const jiraBaseUrl = core.getInput("jira-base-url") || "https://jira.visma.com/browse";

    // 2. Normalize and validate environment
    const environment = normalizeEnvironment(environmentRaw);
    if (!environment) {
      core.setFailed(
        `❌ Invalid environment: "${environmentRaw}". Must be one of: internal, InternalTest, int, stage, production, prod`
      );
      return;
    }

    // 3. Validate app
    const validApps = ["web", "admin", "cm"];
    if (!validApps.includes(app.toLowerCase())) {
      core.setFailed(`❌ Invalid app: "${app}". Must be: ${validApps.join(", ")}`);
      return;
    }

    // 4. Hide credentials
    core.setSecret(googleCredentials);

    core.info(`🚀 Environment: ${environment} (input: ${environmentRaw})`);
    core.info(`📱 App: ${app}`);
    core.info(`📄 Sheet: ${sheetName}`);
    core.info(`🏷️ Version: ${version || "not provided"}`);
    if (tagSuffix) core.info(`🏷️ Tag suffix: ${tagSuffix}`);

    // 5. Get PR info
    const prInfos = await getPRInfo(
      token,
      app,
      environment,
      jiraTickets,
      baseTag,
      headTag,
      tagSuffix
    );

    if (prInfos.length === 0) {
      core.info("ℹ️ No Jira tickets found. Nothing to sync.");
      return;
    }

    // 6. Sync to Google Sheets
    await syncToSheets(googleCredentials, spreadsheetId, sheetName, prInfos, version, jiraBaseUrl);
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}

run();
