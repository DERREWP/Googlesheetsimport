import * as core from "@actions/core";
import * as github from "@actions/github";

async function run() {
  try {
    // 1. Get inputs
    const token = core.getInput("github-token", { required: true });
    const spreadsheetId = core.getInput("spreadsheet-id", { required: true });
    
    // 2. Create GitHub client
    const octokit = github.getOctokit(token);
    
    // 3. Get repo info from context
    const { owner, repo } = github.context.repo;
    
    core.info(`Fetching PRs from ${owner}/${repo}...`);
    
    // 4. Fetch pull requests
    const { data: pullRequests } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "all",      // "open", "closed", or "all"
      per_page: 100,     // max per page
      sort: "updated",
      direction: "desc"
    });
    
    core.info(`Found ${pullRequests.length} pull requests`);
    
    // 5. Map to rows (for Google Sheets later)
    const rows = pullRequests.map(pr => ({
      number: pr.number,
      title: pr.title,
      author: pr.user?.login ?? "unknown",
      state: pr.state,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      url: pr.html_url
    }));
    
    // 6. Log first few PRs (for testing)
    core.info("📋 Sample PRs:");
    rows.slice(0, 5).forEach(row => {
      core.info(`  #${row.number}: ${row.title} (${row.state})`);
    });
    
    // TODO: Next step - send to Google Sheets
    core.info(`📊 Spreadsheet ID: ${spreadsheetId}`);
    core.info("🚧 Google Sheets integration coming next...");
    
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}

run();