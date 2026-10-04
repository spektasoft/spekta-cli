import { execa } from "execa";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getGrepTokenLimit, getIgnorePatterns } from "../../core/config";
import { validateReadPathAccess } from "../../utils/security";
import { resolveWorkspace } from "../../utils/workspace";
import path from "node:path";
import { getGrepContent, MAX_MATCHES } from "../grep-search";
import { getGrepResponseTokenCount } from "../grep-output-parser";
import { runGrep } from "../grep";
import { TOOL_REGISTRY } from "../../api/mcp-server/registry";
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

describe("getGrepContent - truncation", () => {
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

  it("withholds all results when match limit is reached", async () => {
    // Neutralize the token-limit guard so this test isolates MAX_MATCHES only
    vi.mocked(getGrepTokenLimit).mockReturnValue(1_000_000);

    const matches = Array.from({ length: MAX_MATCHES + 1 }, (_, i) =>
      createRgMatch("test.ts", i + 1, 0, `match ${i}`),
    ).join("\n");

    vi.mocked(execa).mockImplementation(() => mockExecaStream(matches));

    const result = await getGrepContent({ pattern: "test" });
    expect(result).toContain("all matches were withheld");
    expect(result).not.toContain("match 0");
  });

  it("withholds all results when complete formatted output exceeds the token limit", async () => {
    vi.mocked(getGrepTokenLimit).mockReturnValue(100);

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

    expect(result).toContain("withheld");
    expect(getGrepResponseTokenCount(result)).toBeLessThanOrEqual(100);
    expect(result).not.toContain("some reasonably long");
  });

  it("counts long lines and filename formatting in the complete response budget", async () => {
    vi.mocked(getGrepTokenLimit).mockReturnValue(100);
    const matches = [
      createRgMatch("a-very-long-filename.ts", 1, 0, "needle".repeat(100)),
      createRgMatch("another-very-long-filename.ts", 1, 0, "needle"),
    ].join("\n");
    vi.mocked(execa).mockImplementation(() => mockExecaStream(matches));

    const result = await getGrepContent({ pattern: "needle" });
    expect(result).toContain("withheld");
    expect(getGrepResponseTokenCount(result)).toBeLessThanOrEqual(100);
    expect(result).not.toContain("a-very-long-filename.ts");
    expect(result).not.toContain("needle");
  });

  it("accepts an exact complete-response budget and rejects one token less", async () => {
    const match = createRgMatch("src/feature.ts", 7, 2, "needle");
    vi.mocked(getGrepTokenLimit).mockReturnValue(2000);
    vi.mocked(execa).mockImplementation(() => mockExecaStream(match));
    const formatted = await getGrepContent({ pattern: "needle" });
    const exactBudget = getGrepResponseTokenCount(formatted);

    vi.mocked(getGrepTokenLimit).mockReturnValue(exactBudget);
    vi.mocked(execa).mockImplementation(() => mockExecaStream(match));
    await expect(getGrepContent({ pattern: "needle" })).resolves.toBe(
      formatted,
    );

    vi.mocked(getGrepTokenLimit).mockReturnValue(exactBudget - 1);
    vi.mocked(execa).mockImplementation(() => mockExecaStream(match));
    const rejected = await getGrepContent({ pattern: "needle" });
    expect(rejected).toContain("withheld");
    expect(rejected).not.toContain("src/feature.ts");
  });

  it("classifies exact-fit and over-budget results through CLI and MCP", async () => {
    const match = [
      createRgMatch("src/feature.ts", 7, 2, `needle${"x".repeat(80)}`),
      createRgMatch("src/other.ts", 12, 0, "needle"),
    ].join("\n");
    const configureRipgrep = () => {
      vi.mocked(execa).mockImplementation((_command, args) => {
        if (Array.isArray(args) && args.includes("--version")) {
          return Promise.resolve({ stdout: "ripgrep 1" }) as never;
        }
        return mockExecaStream(match);
      });
    };

    const requestId = `long-id-${"x".repeat(120)}`;
    vi.mocked(getGrepTokenLimit).mockReturnValue(100_000);
    configureRipgrep();
    const initialMcp = await TOOL_REGISTRY.spekta_grep.handler(
      { pattern: "needle" },
      undefined,
      requestId,
    );
    const formatted = initialMcp.content[0].text;
    const mcpExactLimit = getGrepResponseTokenCount(formatted, requestId);

    vi.mocked(getGrepTokenLimit).mockReturnValue(mcpExactLimit);
    configureRipgrep();
    const exactMcp = await TOOL_REGISTRY.spekta_grep.handler(
      { pattern: "needle" },
      undefined,
      requestId,
    );
    expect(exactMcp.content[0].text).toBe(formatted);

    vi.mocked(getGrepTokenLimit).mockReturnValue(mcpExactLimit - 1);
    configureRipgrep();
    const oversizedMcp = await TOOL_REGISTRY.spekta_grep.handler(
      { pattern: "needle" },
      undefined,
      requestId,
    );
    expect(oversizedMcp.content[0].text).toMatch(/matches (?:were )?withheld/i);
    expect(
      getGrepResponseTokenCount(oversizedMcp.content[0].text, requestId),
    ).toBeLessThanOrEqual(mcpExactLimit - 1);

    const cliExactLimit = getGrepResponseTokenCount(formatted);
    vi.mocked(getGrepTokenLimit).mockReturnValue(cliExactLimit);
    configureRipgrep();
    const cliWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await runGrep(["needle"]);
    expect(cliWrite.mock.calls.map(([chunk]) => String(chunk)).join("")).toBe(
      `${formatted}\n`,
    );
    cliWrite.mockRestore();

    vi.mocked(getGrepTokenLimit).mockReturnValue(cliExactLimit - 1);
    configureRipgrep();
    const overCliWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await runGrep(["needle"]);
    const overCli = overCliWrite.mock.calls
      .map(([chunk]) => String(chunk))
      .join("");
    overCliWrite.mockRestore();
    expect(overCli).toMatch(/matches (?:were )?withheld/i);
    expect(getGrepResponseTokenCount(overCli.trimEnd())).toBeLessThanOrEqual(
      cliExactLimit - 1,
    );
  });
});
