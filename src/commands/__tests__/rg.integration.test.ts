import fs from "fs-extra";
import os from "node:os";
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

let fixture: WorkspaceFixture;
let originalCwd: string;
let originalPath: string | undefined;
let rtkAvailable = false;

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
  it("rejects standard input as a requested path", async () => {
    const outcome = await getRgOutcome(
      { patterns: ["needle"], paths: ["-"], globs: [], case_mode: "sensitive" },
      { root: fixture.root },
    );
    expect(outcome.status).toBe("policy_rejection");
    expect(outcome.message).toContain("Standard input");
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
          return `${event.data.path.text}:${event.data.line_number}:${event.data.lines.text.trim()}`;
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
    const outputText = output.status === "success" ? output.value : "";
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
    const cliText = write.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(cliText).toContain("nested/lower.txt");
    expect(cliText).not.toContain("nested/upper.txt");

    const mcp = await TOOL_REGISTRY.spekta_rg.handler(
      { patterns: ["needle"] },
      { root: fixture.root },
    );
    expect(mcp.content[0]?.text).toContain("nested/lower.txt");
    expect(mcp.content[0]?.text).not.toContain("nested/upper.txt");

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
    expect(noMatchMcp.content[0]?.text).toBe("No matches found.");
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
        },
        { root: fixture.root },
      );
      expect(outcome).toMatchObject({
        status: "engine_failure",
        message: "Search failed: RTK is unavailable.",
      });
      expect(outcome.message).not.toContain(emptyPath);
    } finally {
      await fs.remove(emptyPath);
    }
  });

  it("reports missing ripgrep through a controlled RTK executable", async () => {
    const binPath = await fs.mkdtemp(path.join(os.tmpdir(), "rtk-no-rg-"));
    await fs.writeFile(
      path.join(binPath, "rtk"),
      '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\nprintf \'controlled missing ripgrep details\\n\' >&2\nexit 127\n',
      { mode: 0o755 },
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
      expect(outcome).toMatchObject({
        status: "engine_failure",
        message: "Search failed: ripgrep is unavailable.",
      });
      expect(outcome.message).not.toContain("controlled missing");
      expect(outcome.message).not.toContain(binPath);
    } finally {
      await fs.remove(binPath);
    }
  });

  it("withholds budget overflow through CLI and MCP and cancels RTK's engine child", async () => {
    if (!rtkAvailable) return;
    const binPath = await fs.mkdtemp(path.join(os.tmpdir(), "rtk-cancel-"));
    const pidPath = path.join(binPath, "engine.pid");
    const stoppedPath = path.join(binPath, "engine.stopped");
    const realRtk = (await execa("which", ["rtk"])).stdout.trim();
    await fs.writeFile(
      path.join(fixture.root, "real.txt"),
      "needle repeated content for budget cancellation\n".repeat(10_000),
    );
    await fs.writeFile(
      path.join(binPath, "rtk"),
      `#!${process.execPath}
const { spawn } = require("node:child_process");
const fs = require("node:fs");
if (process.argv.includes("--version")) { console.log("rtk 1"); process.exit(0); }
const engine = spawn(${JSON.stringify(realRtk)}, process.argv.slice(2), { stdio: "inherit" });
const observer = spawn(process.execPath, ["-e", ${JSON.stringify(
        `process.on("SIGTERM", () => { require("node:fs").writeFileSync(${JSON.stringify(stoppedPath)}, "terminated"); process.exit(0); }); setInterval(()=>{}, 1000);`,
      )}], { stdio: "ignore" });
fs.writeFileSync(${JSON.stringify(pidPath)}, String(observer.pid));
engine.on("exit", () => {});
setInterval(()=>{}, 1000);
`,
      { mode: 0o755 },
    );
    const originalTokenLimit = process.env.SPEKTA_GREP_TOKEN_LIMIT;
    process.env.PATH = `${binPath}${path.delimiter}${originalPath ?? ""}`;
    process.env.SPEKTA_GREP_TOKEN_LIMIT = "100";
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
      expect(
        completed,
        `engine terminated: ${await fs.pathExists(stoppedPath)}`,
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
      expect(await fs.pathExists(stoppedPath)).toBe(true);
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
      ).toBeLessThanOrEqual(100);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await fs.pathExists(stoppedPath)).toBe(true);
    } finally {
      cliWrite.mockRestore();
      cliErrorWrite.mockRestore();
      if (originalTokenLimit === undefined)
        delete process.env.SPEKTA_GREP_TOKEN_LIMIT;
      else process.env.SPEKTA_GREP_TOKEN_LIMIT = originalTokenLimit;
      if (await fs.pathExists(pidPath)) {
        const engine = Number(await fs.readFile(pidPath, "utf8"));
        try {
          process.kill(engine, "SIGKILL");
        } catch {
          // The search cancellation may already have reaped the child.
        }
      }
      await fs.remove(binPath);
    }
  });

  it("withholds CLI and MCP results when the match or file ceiling is exceeded", async ({
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
    await runRg(["needle"]);
    const matchCli = matchWrite.mock.calls
      .map(([chunk]) => String(chunk))
      .join("");
    matchWrite.mockRestore();
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
    await runRg(["needle"]);
    const fileCli = fileWrite.mock.calls
      .map(([chunk]) => String(chunk))
      .join("");
    fileWrite.mockRestore();
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
  }, 15_000);
});
