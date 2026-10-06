import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGrep } from "../grep";
import { Logger } from "../../utils/logger";
import * as grepSearch from "../grep-search";

describe("runGrep", () => {
  beforeEach(() => {
    vi.spyOn(Logger, "error").mockReturnValue(true);
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it("logs error and sets exitCode to 1 when search fails", async () => {
    vi.spyOn(grepSearch, "getGrepOutcome").mockResolvedValue({
      status: "engine_failure",
      message: "Ripgrep execution failed",
    });

    await runGrep(["pattern", "src"]);

    expect(Logger.error).toHaveBeenCalledWith("Ripgrep execution failed");
    expect(process.exitCode).toBe(1);
  });

  it("suppresses an empty failure message while preserving the failing exit code", async () => {
    vi.spyOn(grepSearch, "getGrepOutcome").mockResolvedValue({
      status: "engine_failure",
      message: "",
    });

    await runGrep(["pattern"]);

    expect(Logger.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("passes the routed ignore-case option to the search operation", async () => {
    const search = vi.spyOn(grepSearch, "getGrepOutcome").mockResolvedValue({
      status: "success",
      value: "No matches found.",
    });

    await runGrep(["needle", "src", "--ignore-case"]);

    expect(search).toHaveBeenCalledWith({
      pattern: "needle",
      path: "src",
      globs: undefined,
      case_insensitive: true,
    });
  });
});
