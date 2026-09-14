import { describe, it, expect, vi, beforeEach } from "vitest";
import { execa } from "execa";
import { getIgnorePatterns } from "../core/config";
import { isPathIgnored } from "./path-ignore";

vi.mock("execa");
vi.mock("../core/config", () => ({
  getIgnorePatterns: vi.fn(),
}));

describe("isPathIgnored", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getIgnorePatterns).mockResolvedValue([]);
  });

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
