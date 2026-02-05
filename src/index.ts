import * as core from "@actions/core";

async function run() {
  try {
    core.info("✅ Action started");
    const sheetId = core.getInput("spreadsheet-id");
    core.info(`Spreadsheet ID: ${sheetId}`);
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}

run();