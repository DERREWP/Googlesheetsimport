import * as core from "@actions/core";
import { sheets as googleSheets } from "@googleapis/sheets";
import { GoogleAuth } from "google-auth-library";
import { PRInfo } from "./types";

// --- Helpers ---

function getAuth(credentials: string) {
  return new GoogleAuth({
    credentials: JSON.parse(credentials),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
}

async function getAllSheetNames(
  sheets: ReturnType<typeof googleSheets>,
  spreadsheetId: string
): Promise<string[]> {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  return spreadsheet.data.sheets?.map((s) => s.properties?.title ?? "") ?? [];
}

async function getSheetId(
  sheets: ReturnType<typeof googleSheets>,
  spreadsheetId: string,
  sheetName: string
): Promise<number | null> {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = spreadsheet.data.sheets?.find((s) => s.properties?.title === sheetName);
  return sheet?.properties?.sheetId ?? null;
}

function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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

// Capitalize environment to match dropdown
function formatEnvironment(env: string): string {
  const map: Record<string, string> = {
    internal: "Internal",
    stage: "Stage",
    production: "Production"
  };
  return map[env.toLowerCase()] ?? env;
}

// Extract Jira issue key from cell value
// Handles plain text "ADV-123", display text from HYPERLINK, or raw formula '=HYPERLINK("...", "ADV-123")'
function extractIssueKey(cellValue: string): string | null {
  const upper = cellValue.toUpperCase();

  // Plain text: "ADV-123"
  if (upper.startsWith("ADV-")) {
    return upper;
  }

  // Raw formula: =HYPERLINK("...", "ADV-123")
  const formulaMatch = cellValue.match(/HYPERLINK\([^,]+,\s*"(ADV-\d+)"/i);
  if (formulaMatch) {
    return formulaMatch[1].toUpperCase();
  }

  return null;
}

// Capitalize app to match dropdown
function formatApp(app: string): string {
  const map: Record<string, string> = {
    web: "Web",
    admin: "Admin",
    cm: "CM"
  };
  return map[app.toLowerCase()] ?? app;
}

// --- Sheet Operations ---

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
            properties: { sheetId, title: newName },
            fields: "title"
          }
        }
      ]
    }
  });
}

async function copySheet(
  sheets: ReturnType<typeof googleSheets>,
  spreadsheetId: string,
  sourceSheetId: number
): Promise<number> {
  const response = await sheets.spreadsheets.sheets.copyTo({
    spreadsheetId,
    sheetId: sourceSheetId,
    requestBody: { destinationSpreadsheetId: spreadsheetId }
  });
  return response.data.sheetId!;
}

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
            properties: { sheetId, index: 0 },
            fields: "index"
          }
        }
      ]
    }
  });
}

// --- Version Management ---

async function setVersion(
  sheets: ReturnType<typeof googleSheets>,
  spreadsheetId: string,
  sheetName: string,
  cell: string,
  version: string
): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!${cell}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[version]]
    }
  });
}

async function getCellValue(
  sheets: ReturnType<typeof googleSheets>,
  spreadsheetId: string,
  sheetName: string,
  cell: string
): Promise<string> {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!${cell}`
  });
  return String(result.data.values?.[0]?.[0] ?? "");
}

// --- Production Cycle ---

async function handleProductionCycle(
  sheets: ReturnType<typeof googleSheets>,
  spreadsheetId: string,
  sheetName: string
): Promise<void> {
  const today = getTodayDate();

  core.info("🏭 Production deploy detected");

  // 1. Read current "New version" (H2) before archiving
  const currentVersion = await getCellValue(sheets, spreadsheetId, sheetName, "H2");
  core.info(`🏷️ Current version (H2): ${currentVersion}`);

  // 2. Get all existing sheet names
  const existingNames = await getAllSheetNames(sheets, spreadsheetId);
  core.info(`📑 Existing sheets: ${existingNames.join(", ")}`);

  // 3. Generate unique archive name
  const archiveName = getUniqueTabName(today, existingNames);
  core.info(`📅 Archive name: "${archiveName}"`);

  // 4. Get "Next" sheet ID
  const nextSheetId = await getSheetId(sheets, spreadsheetId, sheetName);
  if (nextSheetId === null) {
    core.setFailed(`❌ Sheet "${sheetName}" not found`);
    return;
  }

  // 5. Get "Template" sheet ID
  const templateSheetId = await getSheetId(sheets, spreadsheetId, "Template");
  if (templateSheetId === null) {
    core.setFailed('❌ Sheet "Template" not found');
    return;
  }

  // 6. Rename "Next" to archive name
  await renameSheet(sheets, spreadsheetId, nextSheetId, archiveName);
  core.info(`✅ Renamed "${sheetName}" → "${archiveName}"`);

  // 7. Copy "Template" as new sheet
  const newSheetId = await copySheet(sheets, spreadsheetId, templateSheetId);
  core.info("✅ Copied Template");

  // 8. Rename the copy to "Next"
  await renameSheet(sheets, spreadsheetId, newSheetId, sheetName);
  core.info(`✅ Renamed copy → "${sheetName}"`);

  // 9. Move new "Next" to first position
  await moveSheetToFirst(sheets, spreadsheetId, newSheetId);
  core.info('✅ Moved new "Next" to first tab');

  // 10. Set "Last version deployed" (A2) in new "Next" to the old H2 value
  if (currentVersion) {
    await setVersion(sheets, spreadsheetId, sheetName, "A2", currentVersion);
    core.info(`✅ Set "Last version" (A2) in new "Next" to: ${currentVersion}`);
  }
}

// --- Sync PRs to Sheet ---

async function syncPRsToSheet(
  sheets: ReturnType<typeof googleSheets>,
  spreadsheetId: string,
  sheetName: string,
  prInfos: PRInfo[],
  version: string,
  jiraBaseUrl: string
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

  // 3. Set version in H2 (if provided)
  if (version) {
    await setVersion(sheets, spreadsheetId, sheetName, "H2", version);
    core.info(`🏷️ Set version (H2): ${version}`);
  }

  // 4. Read existing data
  core.info("📖 Reading existing sheet data...");
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range
  });

  const existingRows = existing.data.values ?? [];
  core.info(`📄 Found ${existingRows.length} existing rows`);

  // 5. Find header row dynamically
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

  // 6. Build issue → row map AND find first empty row
  const dataStartIndex = headerRowIndex + 1;
  const issueRowMap = new Map<string, number>();
  let firstEmptyRow = -1;

  core.info(
    `📊 Scanning rows ${dataStartIndex + 1} to ${existingRows.length} for existing issues...`
  );

  for (let i = dataStartIndex; i < existingRows.length; i++) {
    const row = existingRows[i];
    const cellValue = row?.[ISSUE_COL] ? String(row[ISSUE_COL]).trim() : "";

    // Extract issue key - handles both plain text "ADV-123" and HYPERLINK formulas
    const issueKey = extractIssueKey(cellValue);
    if (issueKey) {
      // Existing issue
      const sheetRow = i + 1;
      issueRowMap.set(issueKey, sheetRow);
      core.info(`📍 Found existing: ${issueKey} at row ${sheetRow}`);
    } else if (cellValue === "" && firstEmptyRow === -1) {
      // First empty row (pre-formatted with dropdowns)
      firstEmptyRow = i + 1;
      core.info(`📍 First empty row: ${firstEmptyRow}`);
    }
  }

  // If no empty row found in existing range, use next row after data
  if (firstEmptyRow === -1) {
    firstEmptyRow = existingRows.length + 1;
    core.info(`📍 No empty row found, will use row ${firstEmptyRow}`);
  }

  core.info(`📊 Total tracked issues: ${issueRowMap.size}`);
  core.info(`📊 Looking for: ${prInfos.map((p) => p.issue).join(", ")}`);

  // 7. Process each PR
  let newCount = 0;
  let updateCount = 0;

  for (const pr of prInfos) {
    const issueKey = pr.issue.trim().toUpperCase();
    const existingRow = issueRowMap.get(issueKey);
    const formattedEnv = formatEnvironment(pr.environment);
    const formattedApp = formatApp(pr.app);

    if (existingRow) {
      // UPDATE: Only change environment column (D)
      core.info(`🔄 Updating ${issueKey} at row ${existingRow} → ${formattedEnv}`);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!D${existingRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[formattedEnv]]
        }
      });

      updateCount++;
    } else {
      // NEW: Write into first available empty row
      const targetRow = firstEmptyRow + newCount;
      core.info(`➕ Adding ${issueKey} at row ${targetRow}`);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A${targetRow}:E${targetRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [
            [
              `=HYPERLINK("${jiraBaseUrl}/${pr.issue}", "${pr.issue}")`, // A: Issue (linked to Jira)
              "In progress", // B: Status
              pr.author, // C: Assignee
              formattedEnv, // D: Environment
              formattedApp // E: App
            ]
          ]
        }
      });

      // Track the new issue
      issueRowMap.set(issueKey, targetRow);

      newCount++;
    }
  }

  core.info(`✅ Done! Added ${newCount} new, updated ${updateCount} existing`);
}

// --- Main Export ---

export async function syncToSheets(
  credentials: string,
  spreadsheetId: string,
  sheetName: string,
  prInfos: PRInfo[],
  version: string,
  jiraBaseUrl: string
): Promise<void> {
  // 1. Authenticate
  const auth = getAuth(credentials);
  const sheets = googleSheets({ version: "v4", auth });

  // 2. Get current environment
  const environment = prInfos[0].environment;

  // 3. Update PRs in "Next" sheet
  await syncPRsToSheet(sheets, spreadsheetId, sheetName, prInfos, version, jiraBaseUrl);

  // 4. If production: archive and create new cycle
  if (environment === "production") {
    await handleProductionCycle(sheets, spreadsheetId, sheetName);
  }

  core.info(`📄 Sheet: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
}
