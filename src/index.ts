import * as core from "@actions/core";
import { getPRInfo } from "./github";
import { syncToSheets } from "./sheets";

async function run() {
  try {
    // 1. Get inputs
    const token = core.getInput("github-token", { required: true });
    const spreadsheetId = core.getInput("spreadsheet-id", { required: true });
    const googleCredentials = core.getInput("google-credentials", { required: true });
    const app = core.getInput("app", { required: true });
    const environment = core.getInput("environment", { required: true });
    const version = core.getInput("version") || "";
    const sheetName = core.getInput("sheet-name") || "Next";
    const jiraTickets = core.getInput("jira-tickets") || "";
    const baseTag = core.getInput("base-tag") || "";
    const headTag = core.getInput("head-tag") || "";

    // 2. Validate environment
    const validEnvs = ["internal", "stage", "production"];
    if (!validEnvs.includes(environment.toLowerCase())) {
      core.setFailed(`❌ Invalid environment: "${environment}". Must be: ${validEnvs.join(", ")}`);
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

    core.info(`🚀 Environment: ${environment}`);
    core.info(`📱 App: ${app}`);
    core.info(`📄 Sheet: ${sheetName}`);
    core.info(`🏷️ Version: ${version || "not provided"}`);

    // 5. Get PR info
    const prInfos = await getPRInfo(
      token,
      app,
      environment.toLowerCase(),
      jiraTickets,
      baseTag,
      headTag
    );

    if (prInfos.length === 0) {
      core.info("ℹ️ No Jira tickets found. Nothing to sync.");
      return;
    }

    // 6. Sync to Google Sheets
    await syncToSheets(googleCredentials, spreadsheetId, sheetName, prInfos, version);
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}

run();
