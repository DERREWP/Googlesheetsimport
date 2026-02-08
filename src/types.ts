export interface PRInfo {
  issue: string;
  title: string;
  author: string;
  environment: string;
  app: string;
  url: string;
}

export type Environment = "internal" | "stage" | "production";
