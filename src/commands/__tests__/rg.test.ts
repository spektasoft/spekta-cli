import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRg } from "../rg";
import { Logger } from "../../utils/logger";
import * as grepSearch from "../grep-search";

describe("runRg", () => {
  beforeEach(() => {
    vi.spyOn(Logger, "error").mockReturnValue(true);
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it("uses one pattern, an optional path, and case-sensitive matching by default", async () => {
    const search = vi.spyOn(grepSearch, "getRgOutcome").mockResolvedValue({
      status: "success",
      value: "matches",
    });

    await runRg(["needle", "nested"]);

    expect(search).toHaveBeenCalledWith({
      patterns: ["needle"],
      paths: ["nested"],
      globs: [],
      case_mode: "sensitive",
    });
  });

  it("defaults the path to the workspace root", async () => {
    const search = vi.spyOn(grepSearch, "getRgOutcome").mockResolvedValue({
      status: "no_matches",
      message: "No matches found.",
    });

    await runRg(["needle"]);

    expect(search).toHaveBeenCalledWith({
      patterns: ["needle"],
      paths: [],
      globs: [],
      case_mode: "sensitive",
    });
  });
});
