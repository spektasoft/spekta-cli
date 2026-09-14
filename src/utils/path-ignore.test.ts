import { describe, it, expect, vi, beforeEach } from "vitest";
import { execa } from "execa";
import { getIgnorePatterns } from "../core/config";
import { assertPathNotIgnored, isPathIgnored } from "./path-ignore";

vi.mock("execa");
vi.mock("../core/config", () => ({
  getIgnorePatterns: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getIgnorePatterns).mockResolvedValue([]);
});

describe("isPathIgnored", () => {
  it("returns false for root directory", async () => {
    const result = await isPathIgnored(".");
    expect(result).toBe(false);
  });

  it("returns true when path is ignored by spekta ignore patterns", async () => {
    vi.mocked(getIgnorePatterns).mockResolvedValue(["ignored-dir/"]);
    const result = await isPathIgnored("ignored-dir/file.txt");
    expect(result).toBe(true);
  });

  it("returns true when path is ignored by git check-ignore", async () => {
    vi.mocked(execa).mockResolvedValueOnce({ exitCode: 0 } as any);
    const result = await isPathIgnored("spekta/test-results.json");
    expect(result).toBe(true);
    expect(execa).toHaveBeenCalledWith("git", [
      "check-ignore",
      "-q",
      "spekta/test-results.json",
    ]);
  });

  it("returns false when path is not ignored by git", async () => {
    vi.mocked(execa).mockRejectedValueOnce({ exitCode: 1 });
    const result = await isPathIgnored("src/index.ts");
    expect(result).toBe(false);
  });

  it("respects spekta whitelist negation overrides for gitignored paths", async () => {
    vi.mocked(getIgnorePatterns).mockResolvedValue([
      "!spekta/whitelisted.json",
    ]);
    vi.mocked(execa).mockResolvedValueOnce({ exitCode: 0 } as any);
    const result = await isPathIgnored("spekta/whitelisted.json");
    expect(result).toBe(false);
  });
});

describe("assertPathNotIgnored", () => {
  it("does not throw when the path is not ignored", async () => {
    vi.mocked(execa).mockRejectedValueOnce({ exitCode: 1 });
    await expect(
      assertPathNotIgnored("src/index.ts", "src/index.ts"),
    ).resolves.toBeUndefined();
  });

  it("throws the spektaignore message when blocked by spekta patterns", async () => {
    vi.mocked(getIgnorePatterns).mockResolvedValue(["ignored-dir/"]);
    await expect(
      assertPathNotIgnored("ignored-dir/file.txt", "ignored-dir/file.txt"),
    ).rejects.toThrow(
      "Access Denied: ignored-dir/file.txt is ignored by .spektaignore.",
    );
  });

  it("throws the default git message when blocked by git and no verb override is given", async () => {
    vi.mocked(execa).mockResolvedValueOnce({ exitCode: 0 } as any);
    await expect(
      assertPathNotIgnored(
        "spekta/test-results.json",
        "spekta/test-results.json",
      ),
    ).rejects.toThrow(
      "Access Denied: spekta/test-results.json is ignored by git.",
    );
  });

  it("throws a custom-verb git message when a verb override is given", async () => {
    vi.mocked(execa).mockResolvedValueOnce({ exitCode: 0 } as any);
    await expect(
      assertPathNotIgnored("new/file.ts", "new/file.ts", { git: "would be" }),
    ).rejects.toThrow("Access Denied: new/file.ts would be ignored by git.");
  });

  it("does not throw when the git-ignored path is whitelisted", async () => {
    vi.mocked(getIgnorePatterns).mockResolvedValue([
      "!spekta/whitelisted.json",
    ]);
    vi.mocked(execa).mockResolvedValueOnce({ exitCode: 0 } as any);
    await expect(
      assertPathNotIgnored(
        "spekta/whitelisted.json",
        "spekta/whitelisted.json",
      ),
    ).resolves.toBeUndefined();
  });
});
