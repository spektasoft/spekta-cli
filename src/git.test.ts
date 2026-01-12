import { describe, it, expect, vi, beforeEach } from "vitest";
import { getGitDiff } from "./git";
import { spawnSync } from "child_process";

vi.mock("child_process", () => ({
  spawnSync: vi.fn(),
}));

describe("getGitDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws error for invalid hash format", () => {
    expect(() => getGitDiff("invalid-hash", "abc1234")).toThrow(
      "Invalid commit hash format"
    );
  });

  it("throws error for injection attempts", () => {
    expect(() => getGitDiff("abc1234; rm -rf /", "def5678")).toThrow(
      "Invalid commit hash format"
    );
  });

  it("calls git diff with correct arguments for valid hashes", () => {
    const mockSpawn = vi.mocked(spawnSync);
    mockSpawn.mockReturnValue({
      status: 0,
      stdout: "diff content",
      stderr: "",
      error: undefined,
    } as any);

    const start = "abc1234";
    const end = "def5678";
    const ignore = ["node_modules"];

    const result = getGitDiff(start, end, ignore);

    expect(mockSpawn).toHaveBeenCalledWith(
      "git",
      ["diff", "abc1234..def5678", "--", ".", ":!node_modules"],
      expect.objectContaining({ maxBuffer: 10485760 })
    );
    expect(result).toBe("diff content");
  });

  it("throws error when git command returns non-zero status", () => {
    const mockSpawn = vi.mocked(spawnSync);
    mockSpawn.mockReturnValue({
      status: 128,
      stdout: "",
      stderr: "fatal: not a git repository",
      error: undefined,
    } as any);

    expect(() => getGitDiff("abc1234", "def5678")).toThrow(
      "Git error: fatal: not a git repository"
    );
  });
});
