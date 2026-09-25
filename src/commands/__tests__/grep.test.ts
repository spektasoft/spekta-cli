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
    vi.spyOn(grepSearch, "getGrepContent").mockRejectedValue(
      new Error("Ripgrep execution failed"),
    );

    await runGrep(["pattern", "src"]);

    expect(Logger.error).toHaveBeenCalledWith("Ripgrep execution failed");
    expect(process.exitCode).toBe(1);
  });
});
