export interface PRInfo {
  issue: string; // "ADV-123"
  title: string; // Full PR title
  author: string; // GitHub username
  state: string; // "open" | "closed"
  environment: string; // "internal" | "stage" | "production"
  app: string; // From input
  url: string; // PR URL
}

export interface SheetRow {
  issue: string;
  status: string;
  assignee: string;
  environment: string;
  app: string;
  testedOn: string;
  safeToDeploy: string;
  featureFlag: string;
  activateFlag: string;
  notes: string;
  affectedPages: string;
}
