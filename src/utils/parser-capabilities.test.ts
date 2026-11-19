import { describe, expect, it } from "vitest";
import {
  isStructuralOverviewUnavailable,
  WINDOWS_OVERVIEW_UNAVAILABLE,
} from "./parser-capabilities";

describe("Windows parser-backed capabilities", () => {
  it("marks structural overview unavailable only on Windows", () => {
    expect(isStructuralOverviewUnavailable("win32")).toBe(true);
    expect(isStructuralOverviewUnavailable("linux")).toBe(false);
    expect(isStructuralOverviewUnavailable("darwin")).toBe(false);
  });

  it("provides an explicit user-facing unsupported result", () => {
    expect(WINDOWS_OVERVIEW_UNAVAILABLE).toContain("unsupported_operation");
    expect(WINDOWS_OVERVIEW_UNAVAILABLE).toContain("unavailable on Windows");
  });
});
