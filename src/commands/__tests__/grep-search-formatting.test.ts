import { execa } from "execa";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getGrepTokenLimit, getIgnorePatterns } from "../../core/config";
import { validateReadPathAccess } from "../../utils/security";
import { resolveWorkspace } from "../../utils/workspace";
import path from "node:path";
import { getGrepContent } from "../grep-search";
import { createRgMatch, mockExecaStream } from "./grep-search.test.helpers";

vi.mock("execa");
vi.mock("fs-extra");
vi.mock("../../utils/path-ignore", () => ({
  isPathIgnored: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../utils/security", () => ({
  validateReadPathAccess: vi.fn(),
  RESTRICTED_FILES: [".env", ".gitignore", ".spektaignore"],
}));
vi.mock("../../utils/workspace", () => ({ resolveWorkspace: vi.fn() }));
vi.mock("../../core/config", () => ({
  HOME_IGNORE: "/mock/home/.spektaignore",
  getAssetPaths: () => ({
    ASSET_DEFAULT_IGNORE: "/mock/assets/default.ignore",
  }),
  getGrepTokenLimit: vi.fn().mockReturnValue(2000),
  getIgnorePatterns: vi.fn().mockResolvedValue([]),
}));

describe("getGrepContent - formatting", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getIgnorePatterns).mockResolvedValue([]);
    vi.mocked(resolveWorkspace).mockImplementation((context) => {
      const root = path.resolve(context?.root ?? process.cwd());
      return Promise.resolve({ root, canonicalRoot: root });
    });
    vi.mocked(validateReadPathAccess).mockImplementation((target, workspace) =>
      Promise.resolve(path.resolve(workspace.canonicalRoot, target)),
    );
    vi.mocked(fs.pathExists).mockResolvedValue(false as never);
    vi.mocked(getGrepTokenLimit).mockReturnValue(2000);
  });

  it("returns formatted search results when matches are found", async () => {
    const matchJson = createRgMatch("src/main.ts", 1, 5, "const x = 1;");

    vi.mocked(execa)
      .mockImplementationOnce(() => mockExecaStream(""))
      .mockImplementationOnce(() => mockExecaStream(matchJson));

    const result = await getGrepContent({ pattern: "const", path: "src" });

    expect(result).toContain("#### src/main.ts");
    expect(result).toContain("```ts\n1:5:const x = 1;\n```");
    expect(result).not.toContain('Search Results for "const":');
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

    expect(result).toContain("#### ./file.ts");
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

  it("omits matches from files that are determined to be ignored", async () => {
    const { isPathIgnored } = await import("../../utils/path-ignore");
    vi.mocked(isPathIgnored).mockImplementation((targetPath) => {
      return Promise.resolve(targetPath.includes("ignored.ts"));
    });

    const matches = [
      createRgMatch("ignored.ts", 10, 0, "ignored match"),
      createRgMatch("valid.ts", 20, 0, "valid match"),
    ].join("\n");

    vi.mocked(execa).mockImplementation(() => mockExecaStream(matches));

    const result = await getGrepContent({ pattern: "match" });

    expect(result).not.toContain("ignored.ts");
    expect(result).toContain("valid.ts");
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

    expect(result).toContain("#### ./src/multi.ts");
    expect(result).toContain("```ts\n5:10,25:const a = 1; const b = 2;\n```");
  });
});
