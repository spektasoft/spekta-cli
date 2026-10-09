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

  it("uses repeated regexp options as alternatives and keeps positional operands as separate paths", async () => {
    const search = vi.spyOn(grepSearch, "getRgOutcome").mockResolvedValue({
      status: "no_matches",
      message: "No matches found.",
    });
    await runRg(["src", "-e", "first", "--regexp=second", "docs"]);
    expect(search).toHaveBeenCalledWith({
      patterns: ["first", "second"],
      paths: ["src", "docs"],
      globs: [],
      case_mode: "sensitive",
    });
  });

  it("accepts dash-prefixed patterns and paths after the option terminator", async () => {
    const search = vi.spyOn(grepSearch, "getRgOutcome").mockResolvedValue({
      status: "no_matches",
      message: "No matches found.",
    });
    await runRg(["--", "-pattern", "-directory"]);
    expect(search).toHaveBeenCalledWith({
      patterns: ["-pattern"],
      paths: ["-directory"],
      globs: [],
      case_mode: "sensitive",
    });
  });

  it("rejects unsupported options before searching", async () => {
    const search = vi.spyOn(grepSearch, "getRgOutcome");
    await runRg(["--json"]);
    expect(search).not.toHaveBeenCalled();
    expect(Logger.error).toHaveBeenCalledWith(
      "Unsupported ripgrep option: --json",
    );
  });

  it("passes standard input paths to the search policy for explicit rejection", async () => {
    const search = vi
      .spyOn(grepSearch, "getRgOutcome")
      .mockResolvedValue({
        status: "policy_rejection",
        message: "Standard input search paths are not supported.",
      });
    await runRg(["-e", "needle", "--", "-"]);
    expect(search).toHaveBeenCalledWith({
      patterns: ["needle"],
      paths: ["-"],
      globs: [],
      case_mode: "sensitive",
    });
  });
});
