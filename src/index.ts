import * as core from "@actions/core";
import * as github from "@actions/github";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";

async function run() {
  try {
    // 1. Get inputs
    const token = core.getInput("github-token", { required: true });
    const spreadsheetId = core.getInput("spreadsheet-id", { required: true });
    const range = core.getInput("range", { required: true });
    const googleCredentials = core.getInput("google-credentials", { required: true });

    // 2. Hide credentials from logs
    core.setSecret(googleCredentials);

    // 3. Create GitHub client
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    core.info(`📦 Fetching PRs from ${owner}/${repo}...`);

    // 4. Fetch pull requests
    const { data: pullRequests } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "all",
      per_page: 100,
      sort: "updated",
      direction: "desc"
    });

    core.info(`✅ Found ${pullRequests.length} pull requests`);

    // 5. Map to rows for Google Sheets
    const rows = pullRequests.map((pr) => [
      pr.number,
      pr.title,
      pr.user?.login ?? "unknown",
      pr.state,
      pr.created_at,
      pr.updated_at,
      pr.html_url
    ]);

    // 6. Add header row
    const header = ["PR #", "Title", "Author", "State", "Created", "Updated", "URL"];
    const sheetData = [header, ...rows];

    core.info(`📊 Preparing to write ${sheetData.length} rows to Google Sheets...`);

    // 7. Authenticate with Google
    const credentials = JSON.parse(googleCredentials);
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });

    const sheets = googleSheets({ version: "v4", auth });

    // 8. Clear existing data
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range
    });

    // 9. Write new data
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: sheetData
      }
    });

    core.info(`✅ Successfully wrote ${sheetData.length} rows to Google Sheets!`);
    core.info(`📄 Sheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}

run();
