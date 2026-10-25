import fs from "fs-extra";
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../../__tests__/workspace-fixture";
import { TOOL_REGISTRY } from "../../api/mcp-server/registry";
import { runRg } from "../rg";
import { getRgOutcome } from "../grep-search";
import { getGrepResponseTokenCount } from "../grep-output-parser";
import { getTokenCount } from "../../utils/read-utils";

let fixture: WorkspaceFixture;
let originalCwd: string;
let originalPath: string | undefined;
let rtkAvailable = false;

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForProcessExit(pidPath: string): Promise<boolean> {
  if (!(await fs.pathExists(pidPath))) return false;
  const pid = Number(await fs.readFile(pidPath, "utf8"));
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!processIsRunning(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !processIsRunning(pid);
}

function normalizeReportedPaths(text: string): string {
  return text.replaceAll("\\", "/");
}

vi.setConfig({
  testTimeout: process.platform === "win32" ? 30_000 : 5_000,
});

async function writeFakeRtk(
  binPath: string,
  source: string,
  unixSource = source,
): Promise<void> {
  if (process.platform === "win32") {
    await fs.writeFile(path.join(binPath, "rtk.js"), source);
    await fs.writeFile(
      path.join(binPath, "rtk.cmd"),
      `@echo off\r\n"${process.execPath}" "%~dp0rtk.js" %*\r\nexit /b %ERRORLEVEL%\r\n`,
    );
  } else {
    await fs.writeFile(path.join(binPath, "rtk"), unixSource, {
      mode: 0o755,
    });
  }
}

beforeEach(async () => {
  fixture = await createWorkspaceFixture();
  originalCwd = process.cwd();
  originalPath = process.env.PATH;
  try {
    await execa("rtk", ["proxy", "rg", "--version"]);
    rtkAvailable = true;
  } catch {
    rtkAvailable = false;
  }
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  vi.restoreAllMocks();
  await fixture.cleanup();
});

describe("spekta rg public boundaries", () => {
  it("searches valid roots and reports unavailable roots positionally through CLI and MCP", async ({
    skip,
  }) => {
    if (!rtkAvailable) skip();
    await fs.writeFile(
      path.join(fixture.root, "real.txt"),
      "needle mixed-root\n",
    );
    process.chdir(fixture.root);
    const completeWrite = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);
    await runRg(["-e", "needle", "real.txt"]);
    const completeCliText = completeWrite.mock.calls
      .map(([chunk]) => String(chunk))
      .join("");
    completeWrite.mockRestore();
    const completeMcp = await TOOL_REGISTRY.spekta_rg.handler(
      { patterns: ["needle"], paths: ["real.txt"] },
      { root: fixture.root },
    );
    expect(completeMcp.isError).toBeUndefined();
    expect(completeMcp.content[0]?.text).toBe(completeCliText.trimEnd());
    expect(completeMcp.content[0]?.text).toContain("needle mixed-root");

    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await runRg([
      "-e",
      "needle",
      "real.txt",
      "private-missing.txt",
      "real.txt",
    ]);
    const cliText = write.mock.calls.map(([chunk]) => String(chunk)).join("");
    write.mockRestore();
    const mcp = await TOOL_REGISTRY.spekta_rg.handler(
      {
        patterns: ["needle"],
        paths: ["real.txt", "private-missing.txt", "real.txt"],
        profile: true,
      },
      { root: fixture.root },
    );
    expect(cliText).toContain("Batch: partial_result");
    expect(cliText).toContain("Operand 2: unavailable; unavailable_access");
    expect(cliText).toContain("needle mixed-root");
    expect(cliText).not.toContain("private-missing.txt");
    expect(mcp.content[0]?.text).toBe(cliText.trimEnd());
    expect(mcp.isError).toBe(true);
    expect(mcp.content[0]?.text).not.toContain("private-missing.txt");
    expect(mcp.content[0]?.text).not.toContain("Timings:");
  });

  it("includes reserved aggregate timings only for complete profiled searches", async ({
    skip,
  }) => {
    if (!rtkAvailable) skip();
    await fs.writeFile(path.join(fixture.root, "timed.txt"), "timed needle\n");
    const outcome = await getRgOutcome(
      {
        patterns: ["needle"],
        paths: ["timed.txt"],
        globs: [],
        case_mode: "sensitive",
        allowance: 1000,
        profile: true,
      },
      { root: fixture.root },
      "profile-test",
    );
    expect(outcome.status).toBe("success");
    if (outcome.status === "success") {
      expect(outcome.value).toMatch(
        /Timings: preparation \d+ ms; search \d+ ms\./,
      );
      expect(
        getGrepResponseTokenCount(outcome.value, "profile-test"),
      ).toBeLessThanOrEqual(1000);
    }
  });

  it("reports partial scope when valid roots have no matches", async ({
    skip,
  }) => {
    if (!rtkAvailable) skip();
    await fs.writeFile(path.join(fixture.root, "real.txt"), "different text\n");
    process.chdir(fixture.root);
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await runRg(["-e", "needle", "real.txt", "private-missing.txt"]);
    const cliText = write.mock.calls.map(([chunk]) => String(chunk)).join("");
    write.mockRestore();
    const mcp = await TOOL_REGISTRY.spekta_rg.handler(
      { patterns: ["needle"], paths: ["real.txt", "private-missing.txt"] },
      { root: fixture.root },
    );
    expect(cliText).toContain("Batch: partial_result");
    expect(cliText).toContain("Operand 2: unavailable; unavailable_access");
    expect(cliText).toContain("No matches found.");
    expect(cliText).not.toContain("private-missing.txt");
    expect(mcp.content[0]?.text).toBe(cliText.trimEnd());
    expect(mcp.isError).toBe(true);
  });

  it("rejects oversized scope metadata before starting RTK with a valid root", async () => {
    await fs.writeFile(path.join(fixture.root, "real.txt"), "needle\n");
    const binPath = await fs.mkdtemp(path.join(os.tmpdir(), "rtk-metadata-"));
    const marker = path.join(binPath, "launched");
    await writeFakeRtk(
      binPath,
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "launched"); process.exit(0);`,
      `#!/bin/sh\nprintf launched > '${marker}'\nexit 0\n`,
    );
    const privateRoots = [
      "real.txt",
      ...Array.from({ length: 40 }, (_, index) => `private-root-${index}.txt`),
    ];
    process.env.PATH = binPath;
    try {
      const outcome = await getRgOutcome(
        {
          patterns: ["needle"],
          paths: privateRoots,
          globs: [],
          case_mode: "sensitive",
          allowance: 100,
        },
        { root: fixture.root },
      );
      expect(outcome.status).toBe("output_limit_exceeded");
      if (outcome.status === "output_limit_exceeded") {
        expect(outcome.message).toContain("scope metadata");
        expect(outcome.message).not.toContain("private-root-");
      }
      expect(await fs.pathExists(marker)).toBe(false);
    } finally {
      await fs.remove(binPath);
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });

  it("withholds all mixed-root matches on overflow and retains bounded scope", async ({
    skip,
  }) => {
    if (!rtkAvailable) skip();
    const content = "needle earlier private match\n".repeat(10_000);
    const deniedName = "private-long-denied-root-name-that-must-never-leak";
    const outsideRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "rg-denied-root-"),
    );
    try {
      await fs.writeFile(
        path.join(outsideRoot, "secret.txt"),
        "needle secret\n",
      );
      await fs.symlink(
        outsideRoot,
        path.join(fixture.root, deniedName),
        process.platform === "win32" ? "junction" : "dir",
      );
      await fs.writeFile(path.join(fixture.root, "large.txt"), content);
      process.chdir(fixture.root);
      const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      await runRg([
        "--allowance",
        "1000",
        "-e",
        "needle",
        "large.txt",
        deniedName,
      ]);
      const cliOut = stdout.mock.calls.map(([chunk]) => String(chunk)).join("");
      const cliError = stderr.mock.calls
        .map(([chunk]) => String(chunk))
        .join("");
      stdout.mockRestore();
      stderr.mockRestore();
      const mcp = await TOOL_REGISTRY.spekta_rg.handler(
        {
          patterns: ["needle"],
          paths: ["large.txt", deniedName],
          allowance: 1000,
        },
        { root: fixture.root },
        "mixed-overflow",
      );
      const mcpText = mcp.content[0]?.text ?? "";
      expect(cliError).toContain("All matches withheld");
      expect(cliError).toContain(
        "Scope: 1/2 roots admitted; search incomplete, matches withheld.",
      );
      expect(cliError).toContain("Requested scope is incomplete");
      expect(cliError).toContain("Operand 1: incomplete; matches withheld");
      expect(cliError).toContain("Operand 2: unavailable; unavailable_access");
      expect(`${cliOut}${cliError}`).not.toContain(
        "needle earlier private match",
      );
      expect(`${cliOut}${cliError}`).not.toContain(deniedName);
      expect(getTokenCount(`${cliOut}${cliError}`)).toBeLessThanOrEqual(1000);
      expect(mcp.isError).toBe(true);
      expect(mcpText).toContain(
        "Scope: 1/2 roots admitted; search incomplete, matches withheld.",
      );
      expect(mcpText).toContain("Operand 1: incomplete; matches withheld");
      expect(mcpText).toContain("Operand 2: unavailable; unavailable_access");
      expect(mcpText).not.toContain("needle earlier private match");
      expect(mcpText).not.toContain(deniedName);
      expect(
        getGrepResponseTokenCount(mcpText, "mixed-overflow", true),
      ).toBeLessThanOrEqual(1000);
    } finally {
      await fs.remove(outsideRoot);
    }
  });

  it("returns bounded positional outcomes when every root is unavailable", async () => {
    process.chdir(fixture.root);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await runRg(["-e", "needle", "private-first.txt", "private-second.txt"]);
    const cliText = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");
    stderr.mockRestore();
    const mcp = await TOOL_REGISTRY.spekta_rg.handler(
      {
        patterns: ["needle"],
        paths: ["private-first.txt", "private-second.txt"],
      },
      { root: fixture.root },
      "unavailable-roots",
    );
    expect(cliText).toContain("Operand 1: unavailable; unavailable_access");
    expect(cliText).toContain("Operand 2: unavailable; unavailable_access");
    expect(cliText).not.toContain("private-first.txt");
    expect(cliText).not.toContain("private-second.txt");
    expect(mcp.isError).toBe(true);
    expect(mcp.content[0]?.text).toContain(
      "Operand 1: unavailable; unavailable_access",
    );
    expect(mcp.content[0]?.text).toContain(
      "Operand 2: unavailable; unavailable_access",
    );
    expect(
      getGrepResponseTokenCount(
        mcp.content[0]?.text ?? "",
        "unavailable-roots",
        true,
      ),
    ).toBeLessThanOrEqual(2000);
  });

  it("rejects standard input as a requested path", async () => {
    const outcome = await getRgOutcome(
      { patterns: ["needle"], paths: ["-"], globs: [], case_mode: "sensitive" },
      { root: fixture.root },
    );
    expect(outcome.status).toBe("usage_error");
    expect(outcome.message).toContain("Standard input");
  });

  it("rejects invalid whole-request grammar before launching RTK", async () => {
    const binPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "rtk-invalid-grammar-"),
    );
    const marker = path.join(binPath, "launched");
    await fs.writeFile(
      path.join(binPath, "rtk"),
      `#!/bin/sh\nprintf launched > '${marker}'\nexit 0\n`,
      { mode: 0o755 },
    );
    process.env.PATH = binPath;
    process.chdir(fixture.root);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await runRg(["-e", "needle", "--unsupported-option", "root"]);
      const text = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(text).toContain(
        "usage_error: Unsupported ripgrep option. See `spekta help rg` for supported options.",
      );
      expect(await fs.pathExists(marker)).toBe(false);
    } finally {
      stderr.mockRestore();
      await fs.remove(binPath);
    }
  });

  it("matches native ripgrep for repeated patterns and overlapping paths without duplicate results", async ({
    skip,
  }) => {
    if (!rtkAvailable) skip();
    await fs.ensureDir(path.join(fixture.root, "nested"));
    await fs.writeFile(
      path.join(fixture.root, "nested", "one.txt"),
      "alpha\nBeta\n",
    );
    await fs.writeFile(path.join(fixture.root, "nested", "two.txt"), "gamma\n");
    await fs.writeFile(path.join(fixture.root, "-named.txt"), "delta\n");

    const native = await execa(
      "rg",
      [
        "--no-config",
        "--json",
        "nested",
        "--regexp",
        "alpha",
        "--regexp=gamma",
        "-e",
        "delta",
        "--",
        "nested/one.txt",
        "-named.txt",
      ],
      { cwd: fixture.root },
    );
    const nativeMatches = new Set(
      native.stdout
        .split("\n")
        .filter((line) => line.includes('"type":"match"'))
        .map((line) => {
          const event = JSON.parse(line) as {
            data: {
              path: { text: string };
              line_number: number;
              lines: { text: string };
            };
          };
          return `${normalizeReportedPaths(event.data.path.text)}:${event.data.line_number}:${event.data.lines.text.trim()}`;
        }),
    );
    const output = await getRgOutcome(
      {
        patterns: ["alpha", "gamma", "delta"],
        paths: ["nested", "nested/one.txt", "-named.txt"],
        globs: [],
        case_mode: "sensitive",
      },
      { root: fixture.root },
    );
    expect(output.status).toBe("success");
    const outputText = normalizeReportedPaths(
      output.status === "success" ? output.value : "",
    );
    expect(outputText).toContain("nested/one.txt");
    expect(outputText).toContain("nested/two.txt");
    expect(outputText).toContain("-named.txt");
    expect((outputText.match(/one\.txt/g) ?? []).length).toBe(1);
    expect(nativeMatches).toEqual(
      new Set([
        "nested/one.txt:1:alpha",
        "nested/two.txt:1:gamma",
        "-named.txt:1:delta",
      ]),
    );
    expect(outputText).toContain("1:0:alpha");
    expect(outputText).toContain("1:0:gamma");
  });

  it("keeps overlap deduplication and explicit incomplete scope for unavailable roots", async ({
    skip,
  }) => {
    if (!rtkAvailable) skip();
    await fs.ensureDir(path.join(fixture.root, "nested"));
    await fs.writeFile(
      path.join(fixture.root, "nested", "one.txt"),
      "needle once\n",
    );
    const outcome = await getRgOutcome(
      {
        patterns: ["needle"],
        paths: [
          "nested",
          "nested/one.txt",
          "private-long-unavailable-root-name",
        ],
        globs: [],
        case_mode: "sensitive",
      },
      { root: fixture.root },
    );
    expect(outcome.status).toBe("partial_result");
    if (outcome.status !== "partial_result") return;
    expect(outcome.value).toContain("Scope: 2/3 roots searched.");
    expect(outcome.value).toContain(
      "Operand 3: unavailable; unavailable_access",
    );
    expect(outcome.value).not.toContain("private-long-unavailable-root-name");
    expect((outcome.value.match(/needle once/g) ?? []).length).toBe(1);
  });

  it("keeps combined native search semantics across CLI and MCP boundaries", async ({
    skip,
  }) => {
    if (!rtkAvailable) skip();
    await fs.ensureDir(path.join(fixture.root, "nested"));
    await fs.writeFile(
      path.join(fixture.root, "nested", "one.txt"),
      "alpha lower\nAlpha upper\nBETA uppercase\n",
    );
    await fs.writeFile(
      path.join(fixture.root, "nested", "excluded.txt"),
      "alpha excluded\n",
    );
    await fs.writeFile(
      path.join(fixture.root, "nested", "other.md"),
      "alpha wrong extension\n",
    );

    const native = await execa(
      "rtk",
      [
        "proxy",
        "rg",
        "--no-config",
        "--json",
        "--ignore-case",
        "--case-sensitive",
        "--regexp",
        "alpha",
        "--regexp=BETA",
        "--glob",
        "*.txt",
        "--glob",
        "!excluded.txt",
        "nested",
        "nested/one.txt",
      ],
      { cwd: fixture.root },
    );
    const nativeMatches = new Set(
      native.stdout
        .split("\n")
        .filter((line) => line.includes('"type":"match"'))
        .map((line) => {
          const event = JSON.parse(line) as {
            data: {
              path: { text: string };
              line_number: number;
              lines: { text: string };
            };
          };
          return `${normalizeReportedPaths(event.data.path.text)}:${event.data.line_number}:${event.data.lines.text.trim()}`;
        }),
    );
    const args = [
      "-i",
      "-s",
      "-e",
      "alpha",
      "--regexp=BETA",
      "-g",
      "*.txt",
      "--glob=!excluded.txt",
      "nested",
      "nested/one.txt",
    ];
    const cliWrite = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    process.chdir(fixture.root);
    await runRg(args);
    const cliText = normalizeReportedPaths(
      cliWrite.mock.calls.map(([chunk]) => String(chunk)).join(""),
    );
    cliWrite.mockRestore();
    const mcp = await TOOL_REGISTRY.spekta_rg.handler(
      {
        patterns: ["alpha", "BETA"],
        paths: ["nested", "nested/one.txt"],
        globs: ["*.txt", "!excluded.txt"],
        case_mode: "sensitive",
      },
      { root: fixture.root },
    );
    const mcpText = normalizeReportedPaths(mcp.content[0]?.text ?? "");

    expect(nativeMatches).toEqual(
      new Set([
        "nested/one.txt:1:alpha lower",
        "nested/one.txt:3:BETA uppercase",
      ]),
    );
    for (const text of [cliText, mcpText]) {
      expect(text).toContain("nested/one.txt");
      expect(text).toContain("1:0:alpha lower");
      expect(text).toContain("3:0:BETA uppercase");
      expect(text).not.toContain("Alpha upper");
      expect(text).not.toContain("excluded.txt");
      expect(text).not.toContain("other.md");
      expect((text.match(/one\.txt/g) ?? []).length).toBe(1);
    }
    expect(cliText.trim()).toBe(mcpText);
  });

  it("finds a nested eligible match through CLI and MCP using RTK when available", async ({
    skip,
  }) => {
    if (!rtkAvailable) skip();
    await fs.ensureDir(path.join(fixture.root, "nested"));
    await fs.writeFile(
      path.join(fixture.root, "nested", "lower.txt"),
      "needle lowercase\n",
    );
    await fs.writeFile(
      path.join(fixture.root, "nested", "upper.txt"),
      "Needle uppercase\n",
    );

    process.chdir(fixture.root);
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await runRg(["needle"]);
    const cliText = normalizeReportedPaths(
      write.mock.calls.map(([chunk]) => String(chunk)).join(""),
    );
    expect(cliText).toContain("nested/lower.txt");
    expect(cliText).not.toContain("nested/upper.txt");

    const mcp = await TOOL_REGISTRY.spekta_rg.handler(
      { patterns: ["needle"] },
      { root: fixture.root },
    );
    const mcpText = normalizeReportedPaths(mcp.content[0]?.text ?? "");
    expect(mcpText).toContain("nested/lower.txt");
    expect(mcpText).not.toContain("nested/upper.txt");

    const noMatchWrite = vi
      .spyOn(process.stdout, "write")
      .mockReturnValue(true);
    await runRg(["missing-unique-pattern"]);
    const noMatchCli = noMatchWrite.mock.calls
      .map(([chunk]) => String(chunk))
      .join("");
    noMatchWrite.mockRestore();
    expect(noMatchCli).toContain("No matches found.");
    const noMatchMcp = await TOOL_REGISTRY.spekta_rg.handler(
      { patterns: ["missing-unique-pattern"] },
      { root: fixture.root },
    );
    expect(noMatchMcp.content[0]?.text).toContain("Scope: 1/1 roots searched.");
    expect(noMatchMcp.content[0]?.text).toContain(
      "no_matches: No matches found.",
    );
  });

  it("reports missing RTK without exposing process diagnostics", async () => {
    const emptyPath = await fs.mkdtemp(path.join(os.tmpdir(), "no-rtk-"));
    process.env.PATH = emptyPath;
    try {
      const outcome = await getRgOutcome(
        {
          patterns: ["needle"],
          paths: [],
          globs: [],
          case_mode: "sensitive",
          profile: true,
        },
        { root: fixture.root },
      );
      expect(outcome.status).toBe("engine_failure");
      if (outcome.status === "engine_failure")
        expect(outcome.message).toContain("internal_failure: Search failed.");
      expect(outcome.message).not.toContain(emptyPath);
    } finally {
      await fs.remove(emptyPath);
    }
  });

  it("reports missing ripgrep through a controlled RTK executable", async () => {
    const binPath = await fs.mkdtemp(path.join(os.tmpdir(), "rtk-no-rg-"));
    await writeFakeRtk(
      binPath,
      'if (process.argv[2] === "--version") process.exit(0); process.stderr.write("controlled missing ripgrep details\\n"); process.exit(127);',
      '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\nprintf \'controlled missing ripgrep details\\n\' >&2\nexit 127\n',
    );
    process.env.PATH = `${binPath}${path.delimiter}${originalPath ?? ""}`;
    try {
      const outcome = await getRgOutcome(
        {
          patterns: ["needle"],
          paths: [],
          globs: [],
          case_mode: "sensitive",
        },
        { root: fixture.root },
      );
      expect(outcome.status).toBe("engine_failure");
      if (outcome.status === "engine_failure")
        expect(outcome.message).toContain("internal_failure: Search failed.");
      expect(outcome.message).not.toContain("controlled missing");
      expect(outcome.message).not.toContain("Timings:");
      expect(outcome.message).not.toContain(binPath);
    } finally {
      await fs.remove(binPath);
    }
  });

  it("withholds buffered match data when the search engine fails", async () => {
    const binPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "rtk-buffered-failure-"),
    );
    const matchLine = JSON.stringify({
      type: "match",
      data: {
        path: { text: "real.txt" },
        line_number: 1,
        submatches: [{ start: 0 }],
        lines: { text: "needle buffered private match\n" },
      },
    });
    await writeFakeRtk(
      binPath,
      `const args = process.argv.slice(2); if (args[0] === "--version" || (args[0] === "proxy" && args[1] === "rg" && args[2] === "--version")) process.exit(0); if (args[0] === "proxy" && args[1] === "rg") { process.stdout.write(${JSON.stringify(`${matchLine}\n`)}); process.stderr.write("private engine detail\\n"); process.exit(2); } process.exit(2);`,
      `#!/bin/sh
if [ "$1" = "--version" ]; then exit 0; fi
if [ "$1" = "proxy" ] && [ "$2" = "rg" ] && [ "$3" = "--version" ]; then exit 0; fi
if [ "$1" = "proxy" ] && [ "$2" = "rg" ]; then
  printf '%s\\n' '${matchLine}'
  printf 'private engine detail\\n' >&2
  exit 2
fi
exit 2
`,
    );
    process.env.PATH = `${binPath}${path.delimiter}${originalPath ?? ""}`;
    try {
      const outcome = await getRgOutcome(
        {
          patterns: ["needle"],
          paths: ["real.txt", "private-engine-unavailable-root"],
          globs: [],
          case_mode: "sensitive",
        },
        { root: fixture.root },
      );
      expect(outcome.status).toBe("partial_result");
      if (outcome.status === "partial_result") {
        expect(outcome.value).toContain("Scope: 1/2; incomplete.");
        expect(outcome.value).toContain(
          "Operand 1: search incomplete; internal_failure",
        );
        expect(outcome.value).toContain(
          "Operand 2: unavailable; unavailable_access",
        );
        expect(outcome.value).not.toContain("real.txt");
        expect(outcome.value).not.toContain("buffered private match");
        expect(outcome.value).not.toContain("private engine detail");
        expect(outcome.value).not.toContain("private-engine-unavailable-root");
        expect(outcome.operands).toEqual([
          { position: 1, status: "internal_failure" },
          { position: 2, status: "unavailable" },
        ]);
      }
    } finally {
      await fs.remove(binPath);
    }
  });

  it("withholds budget overflow through CLI and MCP and cancels RTK's engine child", async () => {
    if (!rtkAvailable) return;
    const binPath = await fs.mkdtemp(path.join(os.tmpdir(), "rtk-cancel-"));
    const wrapperPidPath = path.join(binPath, "wrapper.pid");
    const pidPath = path.join(binPath, "engine.pid");
    const stoppedPath = path.join(binPath, "engine.stopped");
    const realRtk = (
      await execa(process.platform === "win32" ? "where.exe" : "which", [
        "rtk",
      ])
    ).stdout
      .split(/\r?\n/)
      .find((entry) => entry.trim())
      ?.trim();
    expect(realRtk).toBeTruthy();
    await fs.writeFile(
      path.join(fixture.root, "real.txt"),
      "needle repeated content for budget cancellation\n".repeat(10_000),
    );
    const cancellationSource = `const { spawn } = require("node:child_process"); const fs = require("node:fs"); if (process.argv.includes("--version")) { console.log("rtk 1"); process.exit(0); } if (process.platform === "win32") fs.writeFileSync(${JSON.stringify(wrapperPidPath)}, String(process.pid)); const engine = spawn(${JSON.stringify(realRtk)}, process.argv.slice(2), { stdio: "inherit" }); if (process.platform === "win32") { fs.writeFileSync(${JSON.stringify(pidPath)}, String(engine.pid)); } else { const observer = spawn(process.execPath, ["-e", ${JSON.stringify(
      `process.on("SIGTERM", () => { require("node:fs").writeFileSync(${JSON.stringify(stoppedPath)}, "terminated"); process.exit(0); }); setInterval(()=>{}, 1000);`,
    )}], { stdio: "ignore" }); fs.writeFileSync(${JSON.stringify(pidPath)}, String(observer.pid)); } setInterval(()=>{}, 1000);`;
    await writeFakeRtk(
      binPath,
      cancellationSource,
      `#!${process.execPath}\n${cancellationSource}`,
    );
    const originalTokenLimit = process.env.SPEKTA_GREP_TOKEN_LIMIT;
    process.env.PATH = `${binPath}${path.delimiter}${originalPath ?? ""}`;
    // 400 covers the expanded cancellation/scope notices plus a real MCP
    // envelope; the test still emits enough matches to exercise cancellation.
    process.env.SPEKTA_GREP_TOKEN_LIMIT = "400";
    await fs.writeFile(
      path.join(fixture.root, ".spektaignore"),
      "ignored.txt\n",
    );
    const cliWrite = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const cliErrorWrite = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);

    try {
      process.chdir(fixture.root);
      const cliRun = runRg(["needle"]);
      const completed = await Promise.race([
        cliRun.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 2000)),
      ]);
      const [wrapperTerminated, engineTerminated] =
        process.platform === "win32"
          ? await Promise.all([
              waitForProcessExit(wrapperPidPath),
              waitForProcessExit(pidPath),
            ])
          : [await fs.pathExists(stoppedPath), true];
      expect(
        completed,
        `owned wrapper terminated: ${wrapperTerminated}; engine terminated: ${engineTerminated}`,
      ).toBe(true);
      const cliText = cliWrite.mock.calls
        .map(([chunk]) => String(chunk))
        .join("");
      const cliErrorText = cliErrorWrite.mock.calls
        .map(([chunk]) => String(chunk))
        .join("");
      expect(completed, cliText + cliErrorText).toBe(true);
      expect(cliText + cliErrorText).toContain("withheld");
      expect(cliText).not.toContain("real.txt");
      expect(cliText).not.toContain("needle ");
      expect(
        process.platform === "win32"
          ? (await waitForProcessExit(wrapperPidPath)) &&
            (await waitForProcessExit(pidPath))
          : await fs.pathExists(stoppedPath),
      ).toBe(true);
      await fs.remove(stoppedPath);

      const mcp = await TOOL_REGISTRY.spekta_rg.handler(
        { patterns: ["needle"] },
        { root: fixture.root },
        "budget-cancel-request",
      );
      const mcpText = mcp.content[0]?.text ?? "";
      expect(mcpText).toContain("withheld");
      expect(mcpText).not.toContain("real.txt");
      expect(mcpText).not.toContain("needle ");
      expect(
        getGrepResponseTokenCount(mcpText, "budget-cancel-request"),
      ).toBeLessThanOrEqual(400);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(
        process.platform === "win32"
          ? await waitForProcessExit(pidPath)
          : await fs.pathExists(stoppedPath),
      ).toBe(true);
    } finally {
      cliWrite.mockRestore();
      cliErrorWrite.mockRestore();
      if (originalTokenLimit === undefined)
        delete process.env.SPEKTA_GREP_TOKEN_LIMIT;
      else process.env.SPEKTA_GREP_TOKEN_LIMIT = originalTokenLimit;
      const cleanupPidPath =
        process.platform === "win32" && (await fs.pathExists(wrapperPidPath))
          ? wrapperPidPath
          : pidPath;
      if (await fs.pathExists(cleanupPidPath)) {
        const ownedProcess = Number(await fs.readFile(cleanupPidPath, "utf8"));
        try {
          if (process.platform === "win32")
            spawnSync(
              "taskkill.exe",
              ["/PID", String(ownedProcess), "/T", "/F"],
              { encoding: "utf8", timeout: 10_000 },
            );
          else process.kill(ownedProcess, "SIGKILL");
        } catch {
          // The search cancellation may already have reaped the child.
        }
      }
      await fs.remove(binPath);
    }
  }, process.platform === "win32" ? 60_000 : 30_000);

  it("withholds CLI and MCP results when the match ceiling is exceeded", async ({
    skip,
  }) => {
    if (!rtkAvailable) skip();
    process.env.SPEKTA_GREP_TOKEN_LIMIT = "1000000";
    process.chdir(fixture.root);

    await fs.writeFile(
      path.join(fixture.root, "real.txt"),
      Array.from({ length: 501 }, (_, index) => `needle match-${index}`).join(
        "\n",
      ),
    );
    const matchWrite = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const matchErrorWrite = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);
    await runRg(["needle"]);
    const matchCli = [...matchWrite.mock.calls, ...matchErrorWrite.mock.calls]
      .map(([chunk]) => String(chunk))
      .join("");
    matchWrite.mockRestore();
    matchErrorWrite.mockRestore();
    const matchMcp = await TOOL_REGISTRY.spekta_rg.handler(
      { patterns: ["needle"] },
      { root: fixture.root },
      "match-ceiling-request",
    );
    const matchMcpText = matchMcp.content[0]?.text ?? "";
    expect(matchCli).toContain("withheld");
    expect(matchCli).not.toContain("match-0");
    expect(matchMcpText).toContain("withheld");
    expect(matchMcpText).not.toContain("match-0");
    expect(
      getGrepResponseTokenCount(matchMcpText, "match-ceiling-request"),
    ).toBeLessThanOrEqual(1_000_000);
  }, process.platform === "win32" ? 60_000 : 30_000);

  it("withholds CLI and MCP results when the file ceiling is exceeded", async ({
    skip,
  }) => {
    if (!rtkAvailable) skip();
    process.env.SPEKTA_GREP_TOKEN_LIMIT = "1000000";
    process.chdir(fixture.root);

    for (let index = 0; index < 101; index++) {
      await fs.writeFile(
        path.join(fixture.root, `ceiling-${index}.txt`),
        "needle file ceiling\n",
      );
    }
    await fs.writeFile(
      path.join(fixture.root, "real.txt"),
      "needle eligible\n",
    );
    const fileWrite = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const fileErrorWrite = vi
      .spyOn(process.stderr, "write")
      .mockReturnValue(true);
    try {
      await runRg(["needle"]);
      const fileCli = [...fileWrite.mock.calls, ...fileErrorWrite.mock.calls]
        .map(([chunk]) => String(chunk))
        .join("");
      fileWrite.mockRestore();
      fileErrorWrite.mockRestore();
      const fileMcp = await TOOL_REGISTRY.spekta_rg.handler(
        { patterns: ["needle"] },
        { root: fixture.root },
        "file-ceiling-request",
      );
      const fileMcpText = fileMcp.content[0]?.text ?? "";
      expect(fileCli).toContain("withheld");
      expect(fileCli).not.toContain("ceiling-0.txt");
      expect(fileMcpText).toContain("withheld");
      expect(fileMcpText).not.toContain("ceiling-0.txt");
      expect(
        getGrepResponseTokenCount(fileMcpText, "file-ceiling-request"),
      ).toBeLessThanOrEqual(1_000_000);
    } finally {
      fileWrite.mockRestore();
      fileErrorWrite.mockRestore();
    }
  }, process.platform === "win32" ? 60_000 : 30_000);
});
