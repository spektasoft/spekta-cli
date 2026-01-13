import { describe, it, expect, vi, beforeEach } from "vitest";
import { getGitDiff } from "./git";
import { execa } from "execa";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

describe("getGitDiff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws error for invalid hash format", async () => {
    await expect(getGitDiff("invalid-hash", "abc1234")).rejects.toThrow(
      "Invalid commit hash format. Use 7-40 hex characters."
    );
  });

  it("throws error for injection attempts", async () => {
    await expect(getGitDiff("abc1234; rm -rf /", "def5678")).rejects.toThrow(
      "Invalid commit hash format. Use 7-40 hex characters."
    );
  });

  it("calls git diff with correct arguments for valid hashes", async () => {
    const mockExeca = vi.mocked(execa);
    mockExeca.mockResolvedValue({
      stdout: "diff content",
    } as any);

    const start = "abc1234";
    const end = "def5678";
    const ignore = ["node_modules"];

    const result = await getGitDiff(start, end, ignore);

    expect(mockExeca).toHaveBeenCalledWith(
      "git",
      ["diff", "abc1234..def5678", "--", ".", ":!node_modules"],
      expect.objectContaining({ maxBuffer: 10485760 })
    );
    expect(result).toBe("diff content");
  });

  it("throws error when git command fails", async () => {
    const mockExeca = vi.mocked(execa);
    mockExeca.mockRejectedValue({
      stderr: "fatal: not a git repository",
    });

    await expect(getGitDiff("abc1234", "def5678")).rejects.toThrow(
      "Git diff failed: fatal: not a git repository"
    );
  });
});
