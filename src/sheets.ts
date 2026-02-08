import * as core from "@actions/core";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import { PRInfo } from "./types";

export async function syncToSheets(
  credentials: string,
  spreadsheetId: string,
  sheetName: string,
  prInfos: PRInfo[]
): Promise<void> {
  // 1. Authenticate
  const auth = new GoogleAuth({
    credentials: JSON.parse(credentials),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  const sheets = googleSheets({ version: "v4", auth });
  const range = `${sheetName}!A:K`;

  // 2. Read existing data
  core.info("📖 Reading existing sheet data...");
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range
  });

  const existingRows = existing.data.values ?? [];
  core.info(`📄 Found ${existingRows.length} existing rows`);

  // 3. Find header row (should be row 1)
  // Issue | Status | Asignee | Environment | App | Tested on | Safe to deploy | Is under Feature Flag? | Activate Flag? | Notes | Affected pages
  const ISSUE_COL = 0;

  // 4. Build a map of existing issues → row number
  const issueRowMap = new Map<string, number>();
  for (let i = 1; i < existingRows.length; i++) {
    const issue = existingRows[i][ISSUE_COL];
    if (issue) {
      issueRowMap.set(issue.toUpperCase(), i + 1); // +1 for 1-based sheets index
    }
  }

  // 5. Process each PR
  let newCount = 0;
  let updateCount = 0;

  for (const pr of prInfos) {
    const existingRow = issueRowMap.get(pr.issue.toUpperCase());

    if (existingRow) {
      // UPDATE: Only change environment column
      core.info(`🔄 Updating ${pr.issue} → ${pr.environment}`);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!D${existingRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[pr.environment]]
        }
      });

      updateCount++;
    } else {
      // NEW: Add full row
      core.info(`➕ Adding new row for ${pr.issue}`);

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A:K`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [
            [
              pr.issue, // Issue
              "In Progress", // Status (default)
              pr.author, // Assignee
              pr.environment, // Environment
              pr.app, // App
              "", // Tested on
              "", // Safe to deploy
              "", // Is under Feature Flag?
              "", // Activate Flag?
              "", // Notes
              "" // Affected pages
            ]
          ]
        }
      });

      newCount++;
    }
  }

  core.info(`✅ Done! Added ${newCount} new rows, updated ${updateCount} existing rows`);
  core.info(`📄 Sheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
}
