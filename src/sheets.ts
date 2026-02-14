import * as core from "@actions/core";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import { PRInfo } from "./types";

function getAuth(credentials: string) {
  return new GoogleAuth({
    credentials: JSON.parse(credentials),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
}

// Get sheet ID by name
async function getSheetId(
  sheets: ReturnType<typeof googleSheets>,
  spreadsheetId: string,
  sheetName: string
): Promise<number | null> {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId
  });

  const sheet = spreadsheet.data.sheets?.find((s) => s.properties?.title === sheetName);

  return sheet?.properties?.sheetId ?? null;
}

// Get today's date as string (YYYY-MM-DD)
function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Rename a sheet tab
async function renameSheet(
  sheets: ReturnType<typeof googleSheets>,
  spreadsheetId: string,
  sheetId: number,
  newName: string
): Promise<void> {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              title: newName
            },
            fields: "title"
          }
        }
      ]
    }
  });
}

// Copy a sheet tab
async function copySheet(
  sheets: ReturnType<typeof googleSheets>,
  spreadsheetId: string,
  sourceSheetId: number
): Promise<number> {
  const response = await sheets.spreadsheets.sheets.copyTo({
    spreadsheetId,
    sheetId: sourceSheetId,
    requestBody: {
      destinationSpreadsheetId: spreadsheetId
    }
  });

  return response.data.sheetId!;
}

// Move sheet to first position
async function moveSheetToFirst(
  sheets: ReturnType<typeof googleSheets>,
  spreadsheetId: string,
  sheetId: number
): Promise<void> {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              index: 0
            },
            fields: "index"
          }
        }
      ]
    }
  });
}

// Handle production deployment: archive "Next" and create new one
async function handleProductionCycle(
  sheets: ReturnType<typeof googleSheets>,
  spreadsheetId: string,
  sheetName: string
): Promise<void> {
  const today = getTodayDate();

  core.info(`🏭 Production deploy detected`);
  core.info(`📅 Archiving "${sheetName}" as "${today}"`);

  // List all sheets for debugging
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetNames = spreadsheet.data.sheets?.map((s) => s.properties?.title);
  core.info(`📑 Available sheets: ${sheetNames?.join(", ")}`);

  // 1. Get "Next" sheet ID
  const nextSheetId = await getSheetId(sheets, spreadsheetId, sheetName);
  if (nextSheetId === null) {
    core.setFailed(`❌ Sheet "${sheetName}" not found`);
    return;
  }

  // 2. Get "Deployment Template" sheet ID
  const templateSheetId = await getSheetId(sheets, spreadsheetId, "Template");
  if (templateSheetId === null) {
    core.setFailed('❌ Sheet "Template" not found');
    return;
  }

  // 3. Rename "Next" to today's date
  await renameSheet(sheets, spreadsheetId, nextSheetId, today);
  core.info(`✅ Renamed "${sheetName}" → "${today}"`);

  // 4. Copy "Deployment Template" as new sheet
  const newSheetId = await copySheet(sheets, spreadsheetId, templateSheetId);
  core.info("✅ Copied Deployment Template");

  // 5. Rename the copy to "Next"
  await renameSheet(sheets, spreadsheetId, newSheetId, sheetName);
  core.info(`✅ Renamed copy → "${sheetName}"`);

  // 6. Move new "Next" to first position
  await moveSheetToFirst(sheets, spreadsheetId, newSheetId);
  core.info('✅ Moved new "Next" to first tab');
}

// Main sync function
export async function syncToSheets(
  credentials: string,
  spreadsheetId: string,
  sheetName: string,
  prInfos: PRInfo[]
): Promise<void> {
  // 1. Authenticate
  const auth = getAuth(credentials);
  const sheets = googleSheets({ version: "v4", auth });

  // 2. Get current environment from first PR
  const environment = prInfos[0].environment;

  // 3. Update PRs in the current "Next" sheet FIRST
  await syncPRsToSheet(sheets, spreadsheetId, sheetName, prInfos);

  // 4. If production: archive and create new cycle
  if (environment === "production") {
    await handleProductionCycle(sheets, spreadsheetId, sheetName);
  }

  core.info(`📄 Sheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
}

// Sync PR data to sheet
async function syncPRsToSheet(
  sheets: ReturnType<typeof googleSheets>,
  spreadsheetId: string,
  sheetName: string,
  prInfos: PRInfo[]
): Promise<void> {
  const range = `${sheetName}!A:K`;

  // 1. Debug info
  core.info(`🔍 Spreadsheet ID: ${spreadsheetId}`);
  core.info(`🔍 Sheet name: ${sheetName}`);
  core.info(`🔍 Range: ${range}`);

  // 2. Verify sheet exists
  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId
    });

    const sheetNames = spreadsheet.data.sheets?.map((s) => s.properties?.title);
    core.info(`📑 Available sheets: ${sheetNames?.join(", ")}`);

    if (!sheetNames?.includes(sheetName)) {
      core.setFailed(`❌ Sheet "${sheetName}" not found. Available: ${sheetNames?.join(", ")}`);
      return;
    }
  } catch (error) {
    core.setFailed(
      `❌ Cannot access spreadsheet. Check:\n` +
        `  - Spreadsheet ID is correct\n` +
        `  - Service account has access\n` +
        `  - Error: ${(error as Error).message}`
    );
    return;
  }

  // 3. Read existing data
  core.info("📖 Reading existing sheet data...");
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range
  });

  const existingRows = existing.data.values ?? [];
  core.info(`📄 Found ${existingRows.length} existing rows`);

  // 2. Build issue → row map
  const ISSUE_COL = 0;
  const HEADER_ROW = 4;
  const issueRowMap = new Map<string, number>();

  for (let i = HEADER_ROW; i < existingRows.length; i++) {
    const issue = existingRows[i][ISSUE_COL];
    if (issue) {
      issueRowMap.set(issue.toUpperCase(), i + 1);
    }
  }
  // 3. Process each PR
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
            [pr.issue, "In Progress", pr.author, pr.environment, pr.app, "", "", "", "", "", ""]
          ]
        }
      });

      newCount++;
    }
  }

  core.info(`✅ Done! Added ${newCount} new, updated ${updateCount} existing`);
}
