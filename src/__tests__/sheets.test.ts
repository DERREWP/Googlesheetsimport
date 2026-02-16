import { describe, it, expect } from "vitest";
import { getUniqueTabName, formatEnvironment, formatApp, extractIssueKey } from "../sheets";

describe("formatEnvironment", () => {
  it("maps internal → Internal", () => {
    expect(formatEnvironment("internal")).toBe("Internal");
  });

  it("maps stage → Stage", () => {
    expect(formatEnvironment("stage")).toBe("Stage");
  });

  it("maps production → Production", () => {
    expect(formatEnvironment("production")).toBe("Production");
  });

  it("is case-insensitive", () => {
    expect(formatEnvironment("INTERNAL")).toBe("Internal");
    expect(formatEnvironment("Stage")).toBe("Stage");
    expect(formatEnvironment("PRODUCTION")).toBe("Production");
  });

  it("returns input for unknown environment", () => {
    expect(formatEnvironment("dev")).toBe("dev");
  });
});

describe("formatApp", () => {
  it("maps web → Web", () => {
    expect(formatApp("web")).toBe("Web");
  });

  it("maps admin → Admin", () => {
    expect(formatApp("admin")).toBe("Admin");
  });

  it("maps cm → CM", () => {
    expect(formatApp("cm")).toBe("CM");
  });

  it("is case-insensitive", () => {
    expect(formatApp("WEB")).toBe("Web");
    expect(formatApp("CM")).toBe("CM");
  });

  it("returns input for unknown app", () => {
    expect(formatApp("other")).toBe("other");
  });
});

describe("extractIssueKey", () => {
  it("extracts plain text ADV-123", () => {
    expect(extractIssueKey("ADV-123")).toBe("ADV-123");
  });

  it("is case-insensitive for plain text", () => {
    expect(extractIssueKey("adv-456")).toBe("ADV-456");
  });

  it("extracts from HYPERLINK formula", () => {
    expect(extractIssueKey('=HYPERLINK("https://jira.visma.com/browse/ADV-789", "ADV-789")')).toBe(
      "ADV-789"
    );
  });

  it("extracts from HYPERLINK with extra spaces", () => {
    expect(extractIssueKey('=HYPERLINK("https://jira.visma.com/browse/ADV-10", "ADV-10")')).toBe(
      "ADV-10"
    );
  });

  it("returns null for empty string", () => {
    expect(extractIssueKey("")).toBeNull();
  });

  it("returns null for non-issue text", () => {
    expect(extractIssueKey("In progress")).toBeNull();
  });

  it("returns null for unrelated formula", () => {
    expect(extractIssueKey("=SUM(A1:A5)")).toBeNull();
  });
});

describe("getUniqueTabName", () => {
  it("returns base name when no collision", () => {
    expect(getUniqueTabName("2026-02-16", ["Next", "Template"])).toBe("2026-02-16");
  });

  it("appends (2) on first collision", () => {
    expect(getUniqueTabName("2026-02-16", ["2026-02-16", "Next"])).toBe("2026-02-16 (2)");
  });

  it("appends (3) when (2) also exists", () => {
    expect(getUniqueTabName("2026-02-16", ["2026-02-16", "2026-02-16 (2)"])).toBe("2026-02-16 (3)");
  });

  it("handles multiple collisions", () => {
    expect(
      getUniqueTabName("2026-02-16", [
        "2026-02-16",
        "2026-02-16 (2)",
        "2026-02-16 (3)",
        "2026-02-16 (4)"
      ])
    ).toBe("2026-02-16 (5)");
  });
});
