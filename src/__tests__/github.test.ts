import { describe, it, expect, vi } from "vitest";

// Mock @actions/core before importing modules that use it
vi.mock("@actions/core", () => ({
  info: vi.fn(),
  warning: vi.fn(),
  setFailed: vi.fn(),
  getInput: vi.fn(),
  setSecret: vi.fn()
}));

vi.mock("@actions/github", () => ({
  getOctokit: vi.fn(),
  context: { repo: { owner: "test", repo: "test" }, payload: {} }
}));

import { extractAllJiraTickets, fromExplicitTickets } from "../github";

describe("extractAllJiraTickets", () => {
  it("extracts a single ticket", () => {
    expect(extractAllJiraTickets("Fix ADV-123 bug")).toEqual(["ADV-123"]);
  });

  it("extracts multiple tickets", () => {
    expect(extractAllJiraTickets("ADV-100 and ADV-200 fix")).toEqual(["ADV-100", "ADV-200"]);
  });

  it("deduplicates tickets", () => {
    expect(extractAllJiraTickets("ADV-100 ADV-100 ADV-100")).toEqual(["ADV-100"]);
  });

  it("is case-insensitive", () => {
    expect(extractAllJiraTickets("adv-99 Adv-99")).toEqual(["ADV-99"]);
  });

  it("returns empty for no tickets", () => {
    expect(extractAllJiraTickets("no tickets here")).toEqual([]);
  });

  it("returns empty for empty string", () => {
    expect(extractAllJiraTickets("")).toEqual([]);
  });

  it("handles ticket at start and end", () => {
    expect(extractAllJiraTickets("ADV-1 some text ADV-2")).toEqual(["ADV-1", "ADV-2"]);
  });

  it("extracts from merge commit message", () => {
    expect(extractAllJiraTickets("Merge pull request #45 from feature/ADV-300-widget")).toEqual([
      "ADV-300"
    ]);
  });

  it("extracts from squash merge message", () => {
    expect(extractAllJiraTickets("ADV-456 Add new feature (#78)")).toEqual(["ADV-456"]);
  });
});

describe("fromExplicitTickets", () => {
  it("splits comma-separated tickets", () => {
    const result = fromExplicitTickets("ADV-1,ADV-2,ADV-3", "cm", "internal");
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.issue)).toEqual(["ADV-1", "ADV-2", "ADV-3"]);
  });

  it("trims whitespace", () => {
    const result = fromExplicitTickets("  ADV-1 , ADV-2  ", "cm", "internal");
    expect(result.map((r) => r.issue)).toEqual(["ADV-1", "ADV-2"]);
  });

  it("uppercases tickets", () => {
    const result = fromExplicitTickets("adv-1,adv-2", "cm", "internal");
    expect(result.map((r) => r.issue)).toEqual(["ADV-1", "ADV-2"]);
  });

  it("filters empty entries", () => {
    const result = fromExplicitTickets("ADV-1,,ADV-2,", "cm", "internal");
    expect(result).toHaveLength(2);
  });

  it("sets correct app and environment", () => {
    const result = fromExplicitTickets("ADV-1", "web", "stage");
    expect(result[0].app).toBe("web");
    expect(result[0].environment).toBe("stage");
  });

  it("returns empty fields for title, author, url", () => {
    const result = fromExplicitTickets("ADV-1", "cm", "internal");
    expect(result[0].title).toBe("");
    expect(result[0].author).toBe("");
    expect(result[0].url).toBe("");
  });
});
