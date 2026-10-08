import fs from "fs-extra";
import os from "os";
import path from "path";
import { spawnSync } from "node:child_process";
import { execa } from "execa";
import { afterEach, beforeEach, vi } from "vitest";
import { runRtkProxy } from "./proxy";
import { TOOL_REGISTRY } from "../../api/mcp-server/registry";

export const missing = ["git", "rtk", "script"].filter(
  (binary) =>
    spawnSync(binary, ["--version"], { stdio: "ignore" }).status !== 0,
);
if (missing.length && process.env.SPEKTA_REQUIRE_GIT_INTEGRATION === "1") {
  throw new Error(
    `Required integration binaries missing: ${missing.join(", ")}`,
  );
}
export const secret = "ghp_abcdefghijklmnopqrstuvwxyz";

function createRealGitContext() {
  let fixture: string;
  let workspace: string;
  let savedExit: typeof process.exitCode;
  let savedEnv: Record<string, string | undefined>;
  const envKeys = [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_PAGER",
    "PAGER",
    "GIT_EXTERNAL_DIFF",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_SYSTEM",
    "GIT_CONFIG_NOSYSTEM",
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_PARAMETERS",
  ];

  async function git(args: string[]) {
    return execa("git", args, {
      cwd: workspace,
      reject: false,
      env: {
        ...process.env,
        NO_COLOR: "1",
        TERM: "dumb",
      },
    });
  }
  async function fixtureGit(args: string[]) {
    const result = await git(args);
    if (result.exitCode !== 0)
      throw new Error(`Fixture git failed: ${result.stderr}`);
    return result.stdout;
  }
  function shellQuote(value: string): string {
    return "'" + value.replace(/'/g, "'\\''") + "'";
  }
  function sentinel(name: string): { program: string; marker: string } {
    const marker = path.join(fixture, `${name}.marker`);
    const program = path.join(fixture, `${name}.sh`);
    fs.writeFileSync(
      program,
      `#!/bin/sh\nprintf 'invoked\\n' >> ${shellQuote(marker)}\nprintf 'SENTINEL OUTPUT\\n'\n`,
    );
    fs.chmodSync(program, 0o755);
    return { program, marker };
  }
  function snapshotRepository(directory = workspace): Record<string, string> {
    const entries: Record<string, string> = {};
    function visit(relative: string): void {
      const absolute = path.join(directory, relative);
      const stat = fs.lstatSync(absolute);
      const metadata = `${stat.mode}:${stat.mtimeMs}`;
      if (stat.isSymbolicLink()) {
        entries[relative] = `link:${metadata}:${fs.readlinkSync(absolute)}`;
      } else if (stat.isDirectory()) {
        entries[relative] = `directory:${metadata}`;
        for (const name of fs.readdirSync(absolute).sort()) {
          visit(relative ? path.join(relative, name) : name);
        }
      } else {
        entries[relative] =
          `file:${metadata}:${fs.readFileSync(absolute).toString("base64")}`;
      }
    }
    visit("");
    return entries;
  }
  async function both(args: string[]) {
    vi.mocked(console.log).mockClear();
    vi.mocked(console.error).mockClear();
    await runRtkProxy("git", args);
    const mcp = await TOOL_REGISTRY.spekta_shell.handler({
      command: "git",
      args,
    });
    const cli = vi
      .mocked(console.log)
      .mock.calls.map((call) => String(call[0]))
      .join("\n");
    return { cli, mcp };
  }

  async function setup(): Promise<void> {
    savedEnv = {};
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
    process.env.GIT_CONFIG_SYSTEM = "/dev/null";
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    savedExit = process.exitCode;
    process.exitCode = undefined;
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), "spekta-real-git-"));
    workspace = path.join(fixture, "workspace");
    fs.ensureDirSync(workspace);
    vi.spyOn(process, "cwd").mockReturnValue(workspace);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await fixtureGit(["init", "--template=", "-b", "main"]);
    await fixtureGit(["config", "user.name", "Proxy Fixture"]);
    await fixtureGit(["config", "user.email", "fixture@example.invalid"]);
    await fixtureGit(["config", "commit.gpgsign", "false"]);
    fs.ensureDirSync(path.join(workspace, "nested"));
    for (const [name, text] of Object.entries({
      "file.txt": "safe-v1\n",
      "other.txt": "other-v1\n",
      "gone.txt": "historical-only\n",
      "space name": "spaces-blob\n",
      "-file": "dash-blob\n",
      "filename-only": "ambiguous-filename\n",
      "nested/file.txt": "nested-blob\n",
      ".env": "restricted-secret\n",
      "big.txt": `${secret}\n${"large allowed line\n".repeat(3000)}`,
    }))
      fs.writeFileSync(path.join(workspace, name), text);
    await fixtureGit(["add", "-f", "--", "."]);
    await fixtureGit(["commit", "-m", "INITIAL_COMMIT"]);
    await fixtureGit(["branch", "feature/topic"]);
    fs.writeFileSync(path.join(workspace, "file.txt"), `safe-v2\n${secret}\n`);
    fs.writeFileSync(path.join(workspace, "other.txt"), "other-v2\n");
    fs.removeSync(path.join(workspace, "gone.txt"));
    await fixtureGit(["add", "-A"]);
    await fixtureGit(["commit", "-m", "SECOND_COMMIT"]);
    fs.writeFileSync(path.join(workspace, "other.txt"), "staged-copy\n");
    await fixtureGit(["add", "--", "other.txt"]);
    fs.writeFileSync(path.join(workspace, "file.txt"), "working-copy\n");
    fs.writeFileSync(path.join(workspace, "other.txt"), "unstaged-copy\n");
    fs.writeFileSync(path.join(workspace, "space name"), "spaces-working\n");
    fs.writeFileSync(path.join(workspace, "-file"), "dash-working\n");
    fs.writeFileSync(
      path.join(workspace, "nested/file.txt"),
      "nested-working\n",
    );
    fs.writeFileSync(path.join(workspace, "untracked.txt"), "untracked\n");
  }

  function teardown(): void {
    vi.restoreAllMocks();
    process.exitCode = savedExit;
    if (fixture) fs.removeSync(fixture);
    for (const [key, value] of Object.entries(savedEnv ?? {})) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  return {
    get fixture() {
      return fixture;
    },
    get workspace() {
      return workspace;
    },
    git,
    fixtureGit,
    shellQuote,
    sentinel,
    snapshotRepository,
    both,
    setup,
    teardown,
  };
}

export function useRealGitFixture() {
  const context = createRealGitContext();
  beforeEach(context.setup, 30000);
  afterEach(context.teardown);
  return context;
}
