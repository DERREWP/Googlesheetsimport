import * as core from "@actions/core";
import { fetchPRInfo } from "./github";
import { syncToSheets } from "./sheets";

async function run() {
  try {
    // 1. Get inputs
    const token = core.getInput("github-token", { required: true });
    const spreadsheetId = core.getInput("spreadsheet-id", { required: true });
    const googleCredentials = core.getInput("google-credentials", { required: true });
    const app = core.getInput("app", { required: true });
    const sheetName = core.getInput("sheet-name") || "Next";

    // 2. Hide credentials
    core.setSecret(googleCredentials);

    // 3. Fetch PR info
    const prInfos = await fetchPRInfo(token, app);

    if (prInfos.length === 0) {
      core.info("ℹ️ No PRs with Jira tickets found. Nothing to sync.");
      return;
    }

    // 4. Sync to Google Sheets
    await syncToSheets(googleCredentials, spreadsheetId, sheetName, prInfos);
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}

run();
