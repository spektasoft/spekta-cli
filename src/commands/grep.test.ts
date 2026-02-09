import { describe, it, expect, vi, beforeEach } from "vitest";
import { getGrepContent } from "./grep";
import { execa } from "execa";
import fs from "fs-extra";

vi.mock("execa");
vi.mock("fs-extra");
vi.mock("../config", () => ({
  HOME_IGNORE: "/mock/home/.spektaignore",
}));

describe("getGrepContent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("throws a descriptive error if ripgrep is not installed", async () => {
    // First call to execa is rg --version
    vi.mocked(execa).mockRejectedValueOnce(new Error("spawn rg ENOENT"));

    await expect(getGrepContent({ pattern: "test" })).rejects.toThrow(
      "ripgrep (rg) is not installed. Please install it",
    );
  });

  it("returns formatted search results when matches are found", async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({} as any) // rg --version check
      .mockResolvedValueOnce({ stdout: "src/main.ts:1:5:const x = 1;" } as any);

    const result = await getGrepContent({ pattern: "const", path: "src" });

    expect(result).toContain('Search Results for "const":');
    expect(result).toContain("```text\nsrc/main.ts:1:5:const x = 1;\n```");
  });

  it("correctly applies glob and case sensitivity flags", async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: "" } as any);

    await getGrepContent({
      pattern: "test",
      globs: "*.ts",
      case_insensitive: false,
    });

    const lastCallArgs = vi.mocked(execa).mock.calls[1][1];
    expect(lastCallArgs).toContain("-g");
    expect(lastCallArgs).toContain("*.ts");
    expect(lastCallArgs).not.toContain("--ignore-case");
  });

  it("includes the --ignore-file flag if .spektaignore exists", async () => {
    vi.mocked(fs.pathExists).mockResolvedValue(true as never);
    vi.mocked(execa).mockResolvedValue({ stdout: "match" } as any);

    await getGrepContent({ pattern: "test" });

    const lastCallArgs = vi.mocked(execa).mock.calls[1][1];
    expect(lastCallArgs).toContain("--ignore-file");
    expect(lastCallArgs).toContain("/mock/home/.spektaignore");
  });

  it("returns 'No matches found.' when ripgrep exit code is 1", async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({} as any)
      .mockRejectedValueOnce({ exitCode: 1 } as any);

    const result = await getGrepContent({ pattern: "nonexistent" });
    expect(result).toBe("No matches found.");
  });

  it("throws a generic Ripgrep error for other execution failures", async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({} as any)
      .mockRejectedValueOnce(new Error("Permission denied"));

    await expect(getGrepContent({ pattern: "test" })).rejects.toThrow(
      "Ripgrep error: Permission denied",
    );
  });
});
