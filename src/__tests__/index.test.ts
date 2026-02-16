import { describe, it, expect } from "vitest";
import { normalizeEnvironment } from "../index";

describe("normalizeEnvironment", () => {
  it("maps 'internal' → 'internal'", () => {
    expect(normalizeEnvironment("internal")).toBe("internal");
  });

  it("maps 'InternalTest' → 'internal'", () => {
    expect(normalizeEnvironment("InternalTest")).toBe("internal");
  });

  it("maps 'int' → 'internal'", () => {
    expect(normalizeEnvironment("int")).toBe("internal");
  });

  it("maps 'stage' → 'stage'", () => {
    expect(normalizeEnvironment("stage")).toBe("stage");
  });

  it("maps 'Stage' → 'stage'", () => {
    expect(normalizeEnvironment("Stage")).toBe("stage");
  });

  it("maps 'production' → 'production'", () => {
    expect(normalizeEnvironment("production")).toBe("production");
  });

  it("maps 'prod' → 'production'", () => {
    expect(normalizeEnvironment("prod")).toBe("production");
  });

  it("maps 'Production' → 'production'", () => {
    expect(normalizeEnvironment("Production")).toBe("production");
  });

  it("returns empty string for unknown env", () => {
    expect(normalizeEnvironment("dev")).toBe("");
    expect(normalizeEnvironment("")).toBe("");
    expect(normalizeEnvironment("qa")).toBe("");
  });
});
