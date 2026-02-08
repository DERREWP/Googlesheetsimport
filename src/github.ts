import * as core from "@actions/core";
import * as github from "@actions/github";
import { PRInfo } from "./types";

// Extract Jira ticket from PR title (e.g., "ADV-123 Some feature")
function extractJiraTicket(title: string): string | null {
  const match = title.match(/ADV-\d+/i);
  return match ? match[0].toUpperCase() : null;
}

// Determine environment from tag name
function getEnvironmentFromTag(tagName: string): string | null {
  const tag = tagName.toLowerCase();

  if (tag.startsWith("internal")) return "internal";
  if (tag.startsWith("stage")) return "stage";
  if (tag.startsWith("production") || tag.startsWith("prod")) return "production";

  return null;
}

export async function fetchPRInfo(token: string, app: string): Promise<PRInfo[]> {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;

  core.info(`📦 Fetching PRs from ${owner}/${repo}...`);

  // 1. Fetch merged pull requests
  const { data: pullRequests } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: "closed",
    sort: "updated",
    direction: "desc",
    per_page: 100
  });

  // 2. Filter only merged PRs
  const mergedPRs = pullRequests.filter((pr) => pr.merged_at !== null);
  core.info(`✅ Found ${mergedPRs.length} merged PRs`);

  // 3. Fetch tags
  const { data: tags } = await octokit.rest.repos.listTags({
    owner,
    repo,
    per_page: 100
  });

  core.info(`🏷️ Found ${tags.length} tags`);

  // 4. Map PRs to PRInfo
  const prInfos: PRInfo[] = [];

  for (const pr of mergedPRs) {
    const issue = extractJiraTicket(pr.title);
    if (!issue) {
      core.warning(`⚠️ Skipping PR #${pr.number}: No Jira ticket found in "${pr.title}"`);
      continue;
    }

    // Find the latest tag associated with this PR's merge commit
    const prMergeSha = pr.merge_commit_sha;
    let environment = "internal"; // Default

    for (const tag of tags) {
      if (tag.commit.sha === prMergeSha) {
        const env = getEnvironmentFromTag(tag.name);
        if (env) {
          environment = env;
          core.info(`🏷️ PR #${pr.number} (${issue}) tagged as ${tag.name} → ${environment}`);
          break;
        }
      }
    }

    prInfos.push({
      issue,
      title: pr.title,
      author: pr.user?.login ?? "unknown",
      state: pr.state,
      environment,
      app,
      url: pr.html_url
    });
  }

  core.info(`📋 Processed ${prInfos.length} PRs with Jira tickets`);
  return prInfos;
}
