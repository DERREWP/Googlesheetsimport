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

// Find the previous tag matching a suffix pattern (e.g., *-int, *-stage, *-prod)
// Mimics: git describe --tags --abbrev=0 --match "*-{suffix}"
async function findPreviousTag(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  suffix: string,
  excludeTag: string
): Promise<string | null> {
  core.info(`🔍 Looking for previous tag matching *-${suffix} (excluding ${excludeTag})...`);

  try {
    // List tags sorted by creation date (newest first), paginated
    const tags: Array<{ name: string; commitSha: string }> = [];
    let page = 1;
    const perPage = 100;

    // Fetch up to 300 tags to find a match
    while (page <= 3) {
      const { data: refs } = await octokit.rest.git.listMatchingRefs({
        owner,
        repo,
        ref: `tags/`,
        per_page: perPage,
        page
      });

      if (refs.length === 0) break;

      for (const ref of refs) {
        const tagName = ref.ref.replace("refs/tags/", "");
        tags.push({ name: tagName, commitSha: ref.object.sha });
      }

      if (refs.length < perPage) break;
      page++;
    }

    // Filter tags that end with the suffix and are not the current tag
    const suffixPattern = `-${suffix}`;
    const matchingTags = tags
      .filter((t) => t.name.endsWith(suffixPattern) && t.name !== excludeTag)
      .sort((a, b) => b.name.localeCompare(a.name)); // Sort descending (newest version first)

    if (matchingTags.length === 0) {
      core.info(`ℹ️ No previous tags found matching *-${suffix}`);
      return null;
    }

    const previousTag = matchingTags[0].name;
    core.info(`✅ Found previous tag: ${previousTag}`);
    return previousTag;
  } catch (error) {
    core.warning(`⚠️ Could not search for previous tags: ${(error as Error).message}`);
    return null;
  }
}

// Option 2: Compare between two tags
// Extracts Jira tickets from both PR titles AND commit messages
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

  // Collect all Jira tickets from commit messages directly
  const allTickets = new Map<string, PRInfo>();

  for (const commit of comparison.commits) {
    const commitMessage = commit.commit.message;
    const commitTickets = extractAllJiraTickets(commitMessage);

    for (const ticket of commitTickets) {
      if (!allTickets.has(ticket)) {
        allTickets.set(ticket, {
          issue: ticket,
          title: commitMessage.split("\n")[0], // First line of commit message
          author: commit.author?.login ?? commit.commit.author?.name ?? "unknown",
          environment,
          app,
          url: commit.html_url
        });
      }
    }
  }

  // Also find merged PRs and extract tickets from PR titles for richer metadata
  const prNumbers = new Set<number>();

  for (const commit of comparison.commits) {
    // Merge commits: "Merge pull request #123 from..."
    const prMatch = commit.commit.message.match(/Merge pull request #(\d+)/);
    if (prMatch) {
      prNumbers.add(parseInt(prMatch[1]));
    }

    // Squash merges: "ADV-123 Feature (#45)"
    const squashMatch = commit.commit.message.match(/#(\d+)\)?$/m);
    if (squashMatch) {
      prNumbers.add(parseInt(squashMatch[1]));
    }
  }

  core.info(`🔗 Found ${prNumbers.size} merged PRs`);

  // Fetch PR details and extract Jira tickets (enriches with PR URL and full title)
  for (const prNumber of prNumbers) {
    try {
      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber
      });

      const tickets = extractAllJiraTickets(pr.title);

      for (const ticket of tickets) {
        // PR info takes precedence over commit info (better metadata)
        allTickets.set(ticket, {
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

  const results = Array.from(allTickets.values());
  core.info(`📋 Total unique Jira tickets found: ${results.length}`);
  return results;
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
  headTag: string,
  tagSuffix: string
): Promise<PRInfo[]> {
  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;

  // Priority 1: Explicit tickets
  if (jiraTicketsInput.trim() !== "") {
    return fromExplicitTickets(jiraTicketsInput, app, environment);
  }

  // Priority 2: Tag comparison with explicit base and head
  if (baseTag.trim() !== "" && headTag.trim() !== "") {
    return fromTagComparison(octokit, owner, repo, baseTag, headTag, app, environment);
  }

  // Priority 3: Auto-detect base tag using tag-suffix
  // When head-tag is given but base-tag is empty, find the previous tag for this environment
  if (headTag.trim() !== "" && tagSuffix.trim() !== "") {
    const previousTag = await findPreviousTag(octokit, owner, repo, tagSuffix, headTag);
    if (previousTag) {
      return fromTagComparison(octokit, owner, repo, previousTag, headTag, app, environment);
    }
    core.info(
      "ℹ️ No previous tag found for auto-detection. Will compare all commits up to head tag."
    );
    // Fall through: compare from repository start to head-tag
    // Use the GitHub API to get the first commit
    try {
      const { data: commits } = await octokit.rest.repos.listCommits({
        owner,
        repo,
        per_page: 1,
        direction: "asc" as const
      });
      if (commits.length > 0) {
        return fromTagComparison(octokit, owner, repo, commits[0].sha, headTag, app, environment);
      }
    } catch {
      core.warning("⚠️ Could not determine first commit for full comparison");
    }
  }

  // Priority 4: Head tag with explicit base tag (base empty means compare from beginning)
  if (baseTag.trim() !== "") {
    return fromTagComparison(octokit, owner, repo, baseTag, headTag, app, environment);
  }

  // Priority 5: Current PR context
  return fromPRContext(octokit, owner, repo, app, environment);
}
