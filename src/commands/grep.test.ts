import { execa } from "execa";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validatePathAccess } from "../utils/security";
import { getGrepContent } from "./grep";

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

  const mockExecaStream = (stdout: string, exitCode = 0) => {
    const promise =
      exitCode === 0
        ? Promise.resolve({ stdout, exitCode })
        : Promise.reject({ exitCode, message: "Command failed" });
    return Object.assign(promise, { stdout: Readable.from(stdout) }) as any;
  };

  it("verifies path access before execution", async () => {
    vi.mocked(execa).mockImplementation(() => mockExecaStream(""));
    await getGrepContent({ pattern: "test", path: "src" });
    expect(validatePathAccess).toHaveBeenCalledWith("src");
  });

  it("returns formatted search results when matches are found", async () => {
    const matchJson = createRgMatch("src/main.ts", 1, 5, "const x = 1;");

    vi.mocked(execa)
      .mockImplementationOnce(() => mockExecaStream("")) // rg --version check
      .mockImplementationOnce(() => mockExecaStream(matchJson));

    const result = await getGrepContent({ pattern: "const", path: "src" });

    expect(result).toContain("#### src/main.ts");
    expect(result).toContain("```ts\n1:5:const x = 1;\n```");
    expect(result).not.toContain('Search Results for "const":');
  });

  it("correctly applies glob and case sensitivity flags", async () => {
    vi.mocked(execa).mockImplementation(() => mockExecaStream(""));

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
      .mockImplementationOnce(() => mockExecaStream(""))
      .mockImplementationOnce(() => mockExecaStream("", 1));

    const result = await getGrepContent({ pattern: "nonexistent" });
    expect(result).toBe("No matches found.");
  });

  it("skips invalid JSON lines and processes valid ones", async () => {
    const validMatch = createRgMatch("file.ts", 10, 2, "valid line");
    const invalidJson = "{ invalid: json ";
    const mixedStdout = `${invalidJson}\n${validMatch}`;

    vi.mocked(execa)
      .mockImplementationOnce(() => mockExecaStream(""))
      .mockImplementationOnce(() => mockExecaStream(mixedStdout));

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
      .mockImplementationOnce(() => mockExecaStream("")) // rg version check
      .mockImplementationOnce(() => mockExecaStream(mockJson));

    const result = await getGrepContent({ pattern: "const", path: "src" });

    expect(result).toContain("#### src/main.ts");
    expect(result).toContain("```ts\n1:5:const x = 1;\n```");
  });

  it("uses the file extension as the markdown language identifier", async () => {
    const mockJson = createRgMatch(
      "src/service.ts",
      10,
      0,
      "export class Service {}",
    );

    vi.mocked(execa)
      .mockImplementationOnce(() => mockExecaStream(""))
      .mockImplementationOnce(() => mockExecaStream(mockJson));

    const result = await getGrepContent({ pattern: "class", path: "src" });

    expect(result).toContain("#### src/service.ts");
    expect(result).toContain("```ts\n10:0:export class Service {}\n```");
  });

  it("supports multiple submatches per line", async () => {
    const mockJson = JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/multi.ts" },
        line_number: 5,
        submatches: [{ start: 10 }, { start: 25 }],
        lines: { text: "const a = 1; const b = 2;" },
      },
    });

    vi.mocked(execa)
      .mockImplementationOnce(() => mockExecaStream(""))
      .mockImplementationOnce(() => mockExecaStream(mockJson));

    const result = await getGrepContent({ pattern: "const" });

    expect(result).toContain("#### src/multi.ts");
    expect(result).toContain("```ts\n5:10,25:const a = 1; const b = 2;\n```");
  });
});
