import { describe, it, expect, vi, beforeEach } from "vitest";
import { runGrep } from "../grep";
import { getGrepOutcome } from "../grep-search";

vi.mock("../grep-search", () => ({
  getGrepOutcome: vi.fn().mockResolvedValue({
    status: "success",
    value: "mocked result",
  }),
}));

describe("runGrep - multi --glob parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("joins multiple --glob flags into a single comma-separated globs string", async () => {
    await runGrep(["pattern", ".", "--glob", "*test*.*", "--glob", "*spec*.*"]);

    expect(getGrepOutcome).toHaveBeenCalledWith({
      pattern: "pattern",
      path: ".",
      globs: "*test*.*,*spec*.*",
    });
  });

  it("passes globs as undefined when no --glob flag is present", async () => {
    await runGrep(["pattern"]);

    expect(getGrepOutcome).toHaveBeenCalledWith({
      pattern: "pattern",
      path: ".",
      globs: undefined,
    });
  });
});
