import { describe, it, expect, vi, beforeEach } from "vitest";
import { runGrep } from "../grep";
import { getGrepContent } from "../grep-search";

vi.mock("../grep-search", () => ({
  getGrepContent: vi.fn().mockResolvedValue("mocked result"),
}));

describe("runGrep - multi --glob parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("joins multiple --glob flags into a single comma-separated globs string", async () => {
    await runGrep(["pattern", ".", "--glob", "*test*.*", "--glob", "*spec*.*"]);

    expect(getGrepContent).toHaveBeenCalledWith({
      pattern: "pattern",
      path: ".",
      globs: "*test*.*,*spec*.*",
    });
  });

  it("passes globs as undefined when no --glob flag is present", async () => {
    await runGrep(["pattern"]);

    expect(getGrepContent).toHaveBeenCalledWith({
      pattern: "pattern",
      path: ".",
      globs: undefined,
    });
  });
});
