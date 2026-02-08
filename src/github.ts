import * as core from "@actions/core";
import * as github from "@actions/github";
import { PRInfo } from "./types";

// Extract all Jira tickets from text
function extractAllJiraTickets(text: string): string[] {
  const matches = text.match(/ADV-\d+/gi);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.toUpperCase()))];
}

// Option 1: Explicit Jira tickets
function fromExplicitTickets(jiraTicketsInput: string, app: string, environment: string): PRInfo[] {
  const tickets = jiraTicketsInput
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0);

  core.info(`📋 Using explicit tickets: ${tickets.join(", ")}`);

  return tickets.map((ticket) => ({
    issue: ticket,
    title: "",
    author: "",
    environment,
    app,
    url: ""
  }));
}

// Option 2: Compare between two tags
async function fromTagComparison(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  baseTag: string,
  headTag: string,
  app: string,
  environment: string
): Promise<PRInfo[]> {
  core.info(`🔍 Comparing ${baseTag}...${headTag}`);

  // Get commits between tags
  const { data: comparison } = await octokit.rest.repos.compareCommits({
    owner,
    repo,
    base: baseTag,
    head: headTag || "HEAD"
  });

  core.info(`📝 Found ${comparison.commits.length} commits between tags`);

  // Find merged PR numbers from commit messages
  const prNumbers = new Set<number>();

  for (const commit of comparison.commits) {
    // Merge commits look like: "Merge pull request #123 from..."
    const prMatch = commit.commit.message.match(/Merge pull request #(\d+)/);
    if (prMatch) {
      prNumbers.add(parseInt(prMatch[1]));
    }

    // Squash merges include PR number: "ADV-123 Feature (#45)"
    const squashMatch = commit.commit.message.match(/#(\d+)\)?$/m);
    if (squashMatch) {
      prNumbers.add(parseInt(squashMatch[1]));
    }
  }

  core.info(`🔗 Found ${prNumbers.size} merged PRs`);

  // Fetch PR details and extract Jira tickets
  const prInfos: PRInfo[] = [];

  for (const prNumber of prNumbers) {
    try {
      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber
      });

      const tickets = extractAllJiraTickets(pr.title);

      for (const ticket of tickets) {
        prInfos.push({
          issue: ticket,
          title: pr.title,
          author: pr.user?.login ?? "unknown",
          environment,
          app,
          url: pr.html_url
        });
      }
    } catch {
      core.warning(`⚠️ Could not fetch PR #${prNumber}`);
    }
  }

  return prInfos;
}

// Option 3: From current PR context
async function fromPRContext(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  app: string,
  environment: string
): Promise<PRInfo[]> {
  const prNumber = github.context.payload.pull_request?.number;

  if (!prNumber) {
    core.info("ℹ️ No PR context available");
    return [];
  }

  core.info(`📦 Extracting from PR #${prNumber}...`);

  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber
  });

  const tickets = extractAllJiraTickets(pr.title);

  return tickets.map((ticket) => ({
    issue: ticket,
    title: pr.title,
    author: pr.user?.login ?? "unknown",
    environment,
    app,
    url: pr.html_url
  }));
}

// Main function - decides which approach to use
export async function getPRInfo(
  token: string,
  app: string,
  environment: string,
  jiraTicketsInput: string,
  baseTag: string,
  headTag: string
): Promise<PRInfo[]> {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;

  // Priority 1: Explicit tickets
  if (jiraTicketsInput.trim() !== "") {
    return fromExplicitTickets(jiraTicketsInput, app, environment);
  }

  // Priority 2: Tag comparison
  if (baseTag.trim() !== "") {
    return fromTagComparison(octokit, owner, repo, baseTag, headTag, app, environment);
  }

  // Priority 3: Current PR context
  return fromPRContext(octokit, owner, repo, app, environment);
}
