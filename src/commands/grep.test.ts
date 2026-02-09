import { describe, it, expect, vi, beforeEach } from "vitest";
import { getGrepContent } from "./grep";
import { execa } from "execa";
import fs from "fs-extra";
import { validatePathAccess } from "../utils/security";

vi.mock("execa");
vi.mock("fs-extra");
vi.mock("../utils/security", () => ({
  validatePathAccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../config", () => ({
  HOME_IGNORE: "/mock/home/.spektaignore",
}));

/**
 * Helper to generate ripgrep JSON output strings
 */
const createRgMatch = (
  file: string,
  line: number,
  col: number,
  text: string,
) => {
  return JSON.stringify({
    type: "match",
    data: {
      path: { text: file },
      line_number: line,
      submatches: [{ start: col }],
      lines: { text: text + "\n" },
    },
  });
};

describe("getGrepContent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(validatePathAccess).mockResolvedValue(undefined);
  });

  it("verifies path access before execution", async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: "" } as any);
    await getGrepContent({ pattern: "test", path: "src" });
    expect(validatePathAccess).toHaveBeenCalledWith("src");
  });

  it("returns formatted search results when matches are found", async () => {
    const matchJson = createRgMatch("src/main.ts", 1, 5, "const x = 1;");

    vi.mocked(execa)
      .mockResolvedValueOnce({} as any) // rg --version check
      .mockResolvedValueOnce({ stdout: matchJson } as any);

    const result = await getGrepContent({ pattern: "const", path: "src" });

    expect(result).toContain("#### src/main.ts");
    expect(result).toContain("```text\n1:5:const x = 1;\n```");
    expect(result).not.toContain('Search Results for "const":');
  });

  it("correctly applies glob and case sensitivity flags", async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: "" } as any);

    await getGrepContent({
      pattern: "test",
      globs: "*.ts",
      case_insensitive: false,
    });

    const lastCallArgs = vi.mocked(execa).mock.calls[1][1];
    expect(lastCallArgs).toContain("--json");
    expect(lastCallArgs).toContain("-g");
    expect(lastCallArgs).toContain("*.ts");
    expect(lastCallArgs).not.toContain("--ignore-case");
  });

  it("returns 'No matches found.' when ripgrep exit code is 1", async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({} as any)
      .mockRejectedValueOnce({ exitCode: 1 } as any);

    const result = await getGrepContent({ pattern: "nonexistent" });
    expect(result).toBe("No matches found.");
  });

  it("skips invalid JSON lines and processes valid ones", async () => {
    const validMatch = createRgMatch("file.ts", 10, 2, "valid line");
    const invalidJson = "{ invalid: json ";
    const mixedStdout = `${invalidJson}\n${validMatch}`;

    vi.mocked(execa)
      .mockResolvedValueOnce({} as any)
      .mockResolvedValueOnce({ stdout: mixedStdout } as any);

    const result = await getGrepContent({ pattern: "test" });

    expect(result).toContain("#### file.ts");
    expect(result).toContain("10:2:valid line");
  });

  it("returns formatted search results in multiple blocks", async () => {
    const mockJson = JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/main.ts" },
        line_number: 1,
        submatches: [{ start: 5 }],
        lines: { text: "const x = 1;" },
      },
    });

    vi.mocked(execa)
      .mockResolvedValueOnce({} as any) // rg version check
      .mockResolvedValueOnce({ stdout: mockJson } as any);

    const result = await getGrepContent({ pattern: "const", path: "src" });

    expect(result).toContain("#### src/main.ts");
    expect(result).toContain("```text\n1:5:const x = 1;\n```");
  });
});
