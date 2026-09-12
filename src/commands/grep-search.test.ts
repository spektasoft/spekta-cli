import { execa } from "execa";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getGrepTokenLimit } from "../core/config";
import { validatePathAccess } from "../utils/security";
import { getGrepContent, MAX_MATCHES } from "./grep-search";
import {
  createRgMatch,
  mockExecaStream,
} from "./__tests__/grep-search.test.helpers";

vi.mock("execa");
vi.mock("fs-extra");
vi.mock("../utils/security", () => ({
  validatePathAccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../core/config", () => ({
  HOME_IGNORE: "/mock/home/.spektaignore",
  getAssetPaths: () => ({
    ASSET_DEFAULT_IGNORE: "/mock/assets/default.ignore",
  }),
  getGrepTokenLimit: vi.fn().mockReturnValue(2000),
}));

describe("getGrepContent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(validatePathAccess).mockResolvedValue(undefined);
    vi.mocked(fs.pathExists).mockResolvedValue(false as never);
    vi.mocked(getGrepTokenLimit).mockReturnValue(2000);
  });

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
    expect(lastCallArgs).toContain("--case-sensitive");
    expect(lastCallArgs).not.toContain("--ignore-case");

    await getGrepContent({
      pattern: "test",
      case_insensitive: true,
    });
    const lastCallArgs2 = vi.mocked(execa).mock.calls[3][1];
    expect(lastCallArgs2).toContain("--ignore-case");
  });

  it("truncates results when match limit is reached", async () => {
    // Neutralize the token-limit guard so this test isolates MAX_MATCHES only
    vi.mocked(getGrepTokenLimit).mockReturnValue(1_000_000);

    const matches = Array.from({ length: MAX_MATCHES + 1 }, (_, i) =>
      createRgMatch("test.ts", i + 1, 0, `match ${i}`),
    ).join("\n");

    vi.mocked(execa).mockImplementation(() => mockExecaStream(matches));

    const result = await getGrepContent({ pattern: "test" });
    expect(result).toContain("Results truncated");
    const matchCount = (result.match(/match \d+/g) || []).length;
    expect(matchCount).toBe(MAX_MATCHES);
  });

  it("truncates results when the grep token limit is reached", async () => {
    vi.mocked(getGrepTokenLimit).mockReturnValue(5);

    const matches = Array.from({ length: 50 }, (_, i) =>
      createRgMatch(
        "huge.ts",
        i + 1,
        0,
        `some reasonably long matched line of source code ${i}`,
      ),
    ).join("\n");

    vi.mocked(execa).mockImplementation(() => mockExecaStream(matches));

    const result = await getGrepContent({ pattern: "some" });

    expect(result).toContain("Results truncated");
    const matchCount = (result.match(/some reasonably long/g) || []).length;
    expect(matchCount).toBeLessThan(50);
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
      .mockImplementationOnce(() => mockExecaStream(""))
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

  it("includes ignore-file flags when ignore files exist", async () => {
    vi.mocked(execa).mockImplementation(() => mockExecaStream(""));

    vi.mocked(fs.pathExists).mockImplementation(async (p: string) => {
      return p.includes(".spektaignore") || p.includes("default.ignore");
    });

    await getGrepContent({ pattern: "test" });

    const searchCallArgs = vi.mocked(execa).mock.calls[1]?.[1];
    if (!Array.isArray(searchCallArgs)) {
      throw new Error("Expected ripgrep search arguments");
    }

    expect(searchCallArgs).toContain("--ignore-file");
    expect(searchCallArgs).toContain("/mock/home/.spektaignore");
    expect(searchCallArgs).toContain("/mock/assets/default.ignore");

    const workspacePath = /.*\.spektaignore/.test(
      searchCallArgs[searchCallArgs.indexOf("--ignore-file") + 1],
    );
    expect(workspacePath).toBeDefined();
  });
});
