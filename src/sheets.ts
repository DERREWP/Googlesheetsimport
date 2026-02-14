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

// Get all sheet names
async function getAllSheetNames(
  sheets: ReturnType<typeof googleSheets>,
  spreadsheetId: string
): Promise<string[]> {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  return spreadsheet.data.sheets?.map((s) => s.properties?.title ?? "") ?? [];
}

// Get sheet ID by name
async function getSheetId(
  sheets: ReturnType<typeof googleSheets>,
  spreadsheetId: string,
  sheetName: string
): Promise<number | null> {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
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

// Generate unique tab name (handles duplicates)
function getUniqueTabName(baseName: string, existingNames: string[]): string {
  if (!existingNames.includes(baseName)) {
    return baseName;
  }

  let counter = 2;
  while (existingNames.includes(`${baseName} (${counter})`)) {
    counter++;
  }

  return `${baseName} (${counter})`;
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

  core.info("🏭 Production deploy detected");

  // 1. Get all existing sheet names
  const existingNames = await getAllSheetNames(sheets, spreadsheetId);
  core.info(`📑 Existing sheets: ${existingNames.join(", ")}`);

  // 2. Generate unique name for archive
  const archiveName = getUniqueTabName(today, existingNames);
  core.info(`📅 Archive name: "${archiveName}"`);

  // 3. Get "Next" sheet ID
  const nextSheetId = await getSheetId(sheets, spreadsheetId, sheetName);
  if (nextSheetId === null) {
    core.setFailed(`❌ Sheet "${sheetName}" not found`);
    return;
  }

  // 4. Get "Template" sheet ID
  const templateSheetId = await getSheetId(sheets, spreadsheetId, "Template");
  if (templateSheetId === null) {
    core.setFailed('❌ Sheet "Template" not found');
    return;
  }

  // 5. Rename "Next" to archive name
  await renameSheet(sheets, spreadsheetId, nextSheetId, archiveName);
  core.info(`✅ Renamed "${sheetName}" → "${archiveName}"`);

  // 6. Copy "Template" as new sheet
  const newSheetId = await copySheet(sheets, spreadsheetId, templateSheetId);
  core.info("✅ Copied Template");

  // 7. Rename the copy to "Next"
  await renameSheet(sheets, spreadsheetId, newSheetId, sheetName);
  core.info(`✅ Renamed copy → "${sheetName}"`);

  // 8. Move new "Next" to first position
  await moveSheetToFirst(sheets, spreadsheetId, newSheetId);
  core.info('✅ Moved new "Next" to first tab');
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
    const sheetNames = await getAllSheetNames(sheets, spreadsheetId);
    core.info(`📑 Available sheets: ${sheetNames.join(", ")}`);

    if (!sheetNames.includes(sheetName)) {
      core.setFailed(`❌ Sheet "${sheetName}" not found. Available: ${sheetNames.join(", ")}`);
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

  // 4. Find header row dynamically
  const ISSUE_COL = 0;
  let headerRowIndex = -1;

  for (let i = 0; i < existingRows.length; i++) {
    const firstCell = String(existingRows[i]?.[ISSUE_COL] ?? "")
      .trim()
      .toLowerCase();
    if (firstCell === "issue") {
      headerRowIndex = i;
      core.info(`📍 Found header row at sheet row ${i + 1}`);
      break;
    }
  }

  if (headerRowIndex === -1) {
    core.warning("⚠️ Could not find header row with 'Issue' in column A");
    core.warning("⚠️ Dumping first 10 rows for debugging:");
    for (let i = 0; i < Math.min(10, existingRows.length); i++) {
      core.warning(`  Row ${i + 1}: ${JSON.stringify(existingRows[i])}`);
    }
    headerRowIndex = 0;
  }

  // 5. Build issue → row map
  const dataStartIndex = headerRowIndex + 1;
  const issueRowMap = new Map<string, number>();

  core.info(
    `📊 Scanning rows ${dataStartIndex + 1} to ${existingRows.length} for existing issues...`
  );

  for (let i = dataStartIndex; i < existingRows.length; i++) {
    const row = existingRows[i];
    if (row && row[ISSUE_COL]) {
      const issue = String(row[ISSUE_COL]).trim().toUpperCase();
      if (issue.startsWith("ADV-")) {
        const sheetRow = i + 1;
        issueRowMap.set(issue, sheetRow);
        core.info(`📍 Found existing: ${issue} at row ${sheetRow}`);
      }
    }
  }

  core.info(`📊 Total tracked issues: ${issueRowMap.size}`);
  core.info(`📊 Looking for: ${prInfos.map((p) => p.issue).join(", ")}`);

  // 6. Process each PR
  let newCount = 0;
  let updateCount = 0;

  for (const pr of prInfos) {
    const issueKey = pr.issue.trim().toUpperCase();
    const existingRow = issueRowMap.get(issueKey);

    if (existingRow) {
      core.info(`🔄 Updating ${issueKey} at row ${existingRow} → ${pr.environment}`);

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
      core.info(`➕ Adding new row for ${issueKey}`);

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

      const newRowIndex = existingRows.length + newCount + 1;
      issueRowMap.set(issueKey, newRowIndex);

      newCount++;
    }
  }

  core.info(`✅ Done! Added ${newCount} new, updated ${updateCount} existing`);
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
