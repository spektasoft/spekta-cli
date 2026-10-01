import fs from "fs-extra";
import os from "os";
import path from "path";
import { spawnSync } from "node:child_process";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRtkProxy } from "./proxy";
import { prepareRtkInvocation } from "./proxy-execution";
import { TOOL_REGISTRY } from "../api/mcp-server/registry";
import { redactSecrets } from "./proxy-secret-redaction";
import { truncateOutput } from "./proxy-output";
import { getTokenCount } from "../utils/read-utils";
import {
  acceptedBranchRequests,
  rejectedBranchRequests,
} from "./proxy-branch.test-fixtures";

const missing = ["git", "rtk", "script"].filter(
  (binary) =>
    spawnSync(binary, ["--version"], { stdio: "ignore" }).status !== 0,
);
if (missing.length && process.env.SPEKTA_REQUIRE_GIT_INTEGRATION === "1") {
  throw new Error(
    `Required integration binaries missing: ${missing.join(", ")}`,
  );
}
const secret = "ghp_abcdefghijklmnopqrstuvwxyz";
const realRequests: string[][] = [
  ...acceptedBranchRequests,
  ["status"],
  ["status", "-s"],
  ["status", "--short"],
  ["status", "-b"],
  ["status", "--branch"],
  ["status", "--porcelain"],
  ["status", "--porcelain=v1"],
  ["status", "--porcelain=v2"],
  ["status", "--untracked-files=no"],
  ["status", "--untracked-files=normal"],
  ["status", "--untracked-files=all"],
  ["status", "--short", "--", "file.txt", "space name", "-file"],
  ["status", "--"],
  ["log"],
  ["log", "--oneline"],
  ["log", "--graph"],
  ["log", "--all"],
  ["log", "--decorate"],
  ["log", "--decorate=short"],
  ["log", "--decorate=full"],
  ["log", "--decorate=no"],
  ["log", "-n", "1"],
  ["log", "--max-count=1"],
  ["log", "-p", "-n", "1"],
  ["log", "--patch", "-n", "1"],
  ["log", "--no-patch"],
  ["log", "--stat", "-n", "1"],
  ["log", "--name-only", "-n", "1"],
  ["log", "--name-status", "-n", "1"],
  ["log", "feature/topic"],
  ["log", "refs/heads/main"],
  ["log", "HEAD~1^0"],
  ["log", "main~1..HEAD"],
  ["log", "main~1...HEAD"],
  ["log", "..HEAD"],
  ["log", "HEAD.."],
  ["log", "--oneline", "HEAD", "--", "gone.txt"],
  ["show"],
  ["show", "--oneline"],
  ["show", "-p"],
  ["show", "--patch"],
  ["show", "--no-patch"],
  ["show", "--stat"],
  ["show", "--name-only"],
  ["show", "--name-status"],
  ["show", "HEAD^"],
  ["show", "feature/topic"],
  ["show", "HEAD", "--", "file.txt"],
  ["show", "--", "gone.txt"],
  ["show", "HEAD:file.txt"],
  ["show", "--no-patch", "HEAD:space name"],
  ["show", "HEAD:-file"],
  ["show", "HEAD^:gone.txt"],
  ["diff"],
  ["diff", "--"],
  ["diff", "-p"],
  ["diff", "--patch"],
  ["diff", "--no-patch"],
  ["diff", "--stat"],
  ["diff", "--name-only"],
  ["diff", "--name-status"],
  ["diff", "--cached"],
  ["diff", "--staged"],
  ["diff", "--cached", "HEAD"],
  ["diff", "--staged", "--stat", "HEAD~1"],
  ["diff", "HEAD"],
  ["diff", "HEAD~1^0"],
  ["diff", "feature/topic"],
  ["diff", "refs/heads/main"],
  ["diff", "HEAD~1", "HEAD"],
  ["diff", "HEAD~1..HEAD"],
  ["diff", "HEAD~1...HEAD"],
  ["diff", "--", "space name", "-file"],
  ["diff", "--cached", "--name-status", "--", "other.txt"],
  ["diff", "--staged", "HEAD~1", "--", "other.txt"],
  ["diff", "--stat", "HEAD", "--", "file.txt"],
  ["diff", "HEAD~1", "HEAD", "--", "file.txt"],
  ["diff", "HEAD~1..HEAD", "--", "gone.txt"],
  ["diff", "HEAD~1...HEAD", "--", "file.txt"],
  ["diff", "--", "missing.txt"],
];
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

describe.skipIf(missing.length > 0)(
  `real Git/RTK inspection${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`,
  () => {
    beforeEach(async () => {
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
      fs.writeFileSync(
        path.join(workspace, "file.txt"),
        `safe-v2\n${secret}\n`,
      );
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
    }, 30000);
    afterEach(() => {
      vi.restoreAllMocks();
      process.exitCode = savedExit;
      if (fixture) fs.removeSync(fixture);
      for (const [key, value] of Object.entries(savedEnv ?? {})) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it.each(realRequests.map((args) => ({ args })))(
      "preserves native Git meaning for $args in both adapters",
      async ({ args }) => {
        const history = ["log", "show", "diff"].includes(args[0]);
        const before = ["diff", "branch"].includes(args[0])
          ? snapshotRepository()
          : undefined;
        // Independent reference from the user grammar, not from prepareRtkInvocation.
        const reference = await git([
          "--no-pager",
          "--literal-pathspecs",
          ...(args[0] === "diff" ? ["-c", "diff.autoRefreshIndex=false"] : []),
          args[0],
          ...(history ? ["--no-ext-diff", "--no-textconv"] : []),
          ...(args[0] === "diff" ? ["--submodule=short"] : []),
          ...args.slice(1),
          ...(history && !args.includes("--") ? ["--"] : []),
        ]);
        expect(reference.exitCode).toBe(0);
        const raw = [reference.stdout, reference.stderr]
          .filter(Boolean)
          .join("\n");
        const expected = redactSecrets(truncateOutput(raw).content);
        const original = [...args];
        const { cli, mcp } = await both(args);
        if (before !== undefined) expect(snapshotRepository()).toEqual(before);
        expect(mcp.isError).toBe(false);
        expect(mcp.content[0].text).toBe(expected);
        expect(cli).toContain(expected);
        expect(cli).toContain("### spekta git");
        expect(cli).not.toContain(secret);
        expect(mcp.content[0].text).not.toContain(secret);
        expect(args).toEqual(original);
        expect(console.error).not.toHaveBeenCalled();
      },
    );

    it("keeps working-tree, staged, and HEAD diff meanings distinct", async () => {
      const before = snapshotRepository();
      const working = await both(["diff", "--", "other.txt"]);
      expect(working.mcp.isError).toBe(false);
      expect(working.mcp.content[0].text).toContain("-staged-copy");
      expect(working.mcp.content[0].text).toContain("+unstaged-copy");
      const staged = await both(["diff", "--cached", "--", "other.txt"]);
      expect(staged.mcp.isError).toBe(false);
      expect(staged.mcp.content[0].text).toContain("-other-v2");
      expect(staged.mcp.content[0].text).toContain("+staged-copy");
      expect(staged.mcp.content[0].text).not.toContain("unstaged-copy");
      const alias = await both(["diff", "--staged", "--", "other.txt"]);
      expect(alias.mcp.content[0].text).toBe(staged.mcp.content[0].text);
      const head = await both(["diff", "HEAD", "--", "other.txt"]);
      expect(head.mcp.isError).toBe(false);
      expect(head.mcp.content[0].text).toContain("-other-v2");
      expect(head.mcp.content[0].text).toContain("+unstaged-copy");
      expect(head.mcp.content[0].text).not.toContain("+staged-copy");
      expect(snapshotRepository()).toEqual(before);
    });

    it("compares revisions and preserves hashes and historical missing paths", async () => {
      const hash = await fixtureGit(["rev-parse", "HEAD"]);
      const before = snapshotRepository();
      const pair = await both(["diff", "HEAD~1", hash, "--", "file.txt"]);
      expect(pair.mcp.isError).toBe(false);
      expect(pair.mcp.content[0].text).toContain("-safe-v1");
      expect(pair.mcp.content[0].text).toContain("+safe-v2");
      expect(pair.mcp.content[0].text).not.toContain("working-copy");
      const range = await both(["diff", `HEAD~1..${hash}`, "--", "file.txt"]);
      expect(range.mcp.content[0].text).toBe(pair.mcp.content[0].text);
      const deleted = await both(["diff", "HEAD~1", hash, "--", "gone.txt"]);
      expect(deleted.mcp.isError).toBe(false);
      expect(deleted.mcp.content[0].text).toContain("-historical-only");
      expect(snapshotRepository()).toEqual(before);
    });

    it("distinguishes two-dot endpoints from three-dot merge-base comparison", async () => {
      await fixtureGit([
        "restore",
        "--source=HEAD",
        "--staged",
        "--worktree",
        "--",
        ".",
      ]);
      await fixtureGit(["checkout", "-b", "left", "HEAD~1"]);
      fs.writeFileSync(path.join(workspace, "left.txt"), "left-only\n");
      await fixtureGit(["add", "--", "left.txt"]);
      await fixtureGit(["commit", "-m", "LEFT_COMMIT", "--", "left.txt"]);
      await fixtureGit(["checkout", "-b", "right", "main"]);
      fs.writeFileSync(path.join(workspace, "right.txt"), "right-only\n");
      await fixtureGit(["add", "--", "right.txt"]);
      await fixtureGit(["commit", "-m", "RIGHT_COMMIT", "--", "right.txt"]);
      const before = snapshotRepository();
      const endpoints = await both(["diff", "--name-status", "left..right"]);
      expect(endpoints.mcp.isError).toBe(false);
      expect(endpoints.mcp.content[0].text).toContain("left.txt");
      expect(endpoints.mcp.content[0].text).toContain("right.txt");
      const mergeBase = await both(["diff", "--name-status", "left...right"]);
      expect(mergeBase.mcp.isError).toBe(false);
      expect(mergeBase.mcp.content[0].text).not.toContain("left.txt");
      expect(mergeBase.mcp.content[0].text).toContain("right.txt");
      expect(snapshotRepository()).toEqual(before);
    });

    it("uses cwd-relative paths in a nested workspace", async () => {
      vi.spyOn(process, "cwd").mockReturnValue(path.join(workspace, "nested"));
      const before = snapshotRepository();
      const allowed = await both(["diff", "--", "file.txt"]);
      expect(allowed.mcp.isError).toBe(false);
      expect(allowed.mcp.content[0].text).toContain("-nested-blob");
      expect(allowed.mcp.content[0].text).toContain("+nested-working");
      expect(allowed.mcp.content[0].text).not.toContain("working-copy");
      const rejected = await both(["diff", "--", "../file.txt"]);
      expect(rejected.mcp.isError).toBe(true);
      expect(rejected.mcp.content[0].text).toMatch(
        /outside the project directory/i,
      );
      expect(snapshotRepository()).toEqual(before);
    });

    it("supports staged inspection before the first commit", async () => {
      const unborn = path.join(fixture, "unborn");
      fs.ensureDirSync(unborn);
      const init = await execa("git", ["init", "--template=", "-b", "main"], {
        cwd: unborn,
      });
      expect(init.exitCode).toBe(0);
      fs.writeFileSync(path.join(unborn, "new.txt"), "first-staged\n");
      await execa("git", ["add", "--", "new.txt"], { cwd: unborn });
      vi.spyOn(process, "cwd").mockReturnValue(unborn);
      const before = snapshotRepository(unborn);
      for (const selector of ["--cached", "--staged"]) {
        const result = await both(["diff", selector, "--", "new.txt"]);
        expect(result.mcp.isError).toBe(false);
        expect(result.mcp.content[0].text).toContain("+first-staged");
      }
      expect(snapshotRepository(unborn)).toEqual(before);
    });

    it("keeps index metadata unchanged for stat-only worktree changes", async () => {
      await fixtureGit(["config", "diff.autoRefreshIndex", "true"]);
      const unchanged = path.join(workspace, "filename-only");
      const stat = fs.statSync(unchanged);
      fs.utimesSync(unchanged, stat.atime, new Date(stat.mtimeMs + 10000));
      const before = snapshotRepository();
      const result = await both(["diff", "--", "filename-only"]);
      expect(result.mcp.isError).toBe(false);
      expect(result.mcp.content[0].text).toBe("");
      expect(snapshotRepository()).toEqual(before);
    });

    it("condenses and redacts real working-tree and staged patch output", async () => {
      for (const staged of [false, true]) {
        const name = staged ? "large-staged.txt" : "large-working.txt";
        fs.writeFileSync(path.join(workspace, name), "baseline\n");
        await fixtureGit(["add", "--", name]);
        await fixtureGit(["commit", "-m", "LARGE_BASE", "--", name]);
        fs.writeFileSync(
          path.join(workspace, name),
          `${secret}\n${"large diff line\n".repeat(3000)}`,
        );
        if (staged) await fixtureGit(["add", "--", name]);
        const before = snapshotRepository();
        const result = await both([
          "diff",
          ...(staged ? ["--cached"] : []),
          "--",
          name,
        ]);
        expect(result.mcp.isError).toBe(false);
        expect(result.cli).toContain("OUTPUT TRUNCATED");
        expect(result.mcp.content[0].text).toContain("lines collapsed");
        expect(result.cli).not.toContain(secret);
        expect(result.mcp.content[0].text).not.toContain(secret);
        expect(getTokenCount(result.mcp.content[0].text)).toBeLessThanOrEqual(
          1000,
        );
        expect(snapshotRepository()).toEqual(before);
      }
    });

    it("selects requested commits and files rather than unrelated ones", async () => {
      const limited = await both(["log", "--oneline", "-n", "1"]);
      expect(limited.mcp.content[0].text).toContain("SECOND_COMMIT");
      expect(limited.mcp.content[0].text).not.toContain("INITIAL_COMMIT");
      const range = await both(["log", "--oneline", "main~1..HEAD"]);
      expect(range.mcp.content[0].text).toContain("SECOND_COMMIT");
      expect(range.mcp.content[0].text).not.toContain("INITIAL_COMMIT");
      const patch = await both(["show", "HEAD", "--", "file.txt"]);
      expect(patch.mcp.content[0].text).toContain("safe-v2");
      expect(patch.mcp.content[0].text).not.toContain("other-v2");
      const blob = await both(["show", "HEAD:file.txt"]);
      expect(blob.mcp.content[0].text).toBe("safe-v2\n[REDACTED]");
      expect(blob.mcp.content[0].text).not.toContain("working-copy");
    });

    it("supports a hash revision and historical missing path", async () => {
      const hash = await fixtureGit(["rev-parse", "HEAD"]);
      const hashed = await both(["show", "--no-patch", hash]);
      expect(hashed.mcp.isError).toBe(false);
      expect(hashed.mcp.content[0].text).toContain("SECOND_COMMIT");
      const deleted = await both(["show", "HEAD^:gone.txt"]);
      expect(deleted.mcp.content[0].text).toBe("historical-only");
    });

    it("keeps repo-relative blob meaning from nested cwd", async () => {
      vi.spyOn(process, "cwd").mockReturnValue(path.join(workspace, "nested"));
      const allowed = await both(["show", "HEAD:nested/file.txt"]);
      expect(allowed.mcp.content[0].text).toBe("nested-blob");
      const rejected = await both(["show", "HEAD:file.txt"]);
      expect(rejected.mcp.isError).toBe(true);
      expect(rejected.mcp.content[0].text).toMatch(
        /outside the project directory/i,
      );
      expect(console.error).toHaveBeenCalled();
    });

    it("supports a real worktree repository marker", async () => {
      const worktree = path.join(fixture, "worktree");
      await fixtureGit(["worktree", "add", "--detach", worktree, "HEAD"]);
      vi.spyOn(process, "cwd").mockReturnValue(worktree);
      const result = await both(["show", "HEAD:nested/file.txt"]);
      expect(result.mcp.isError).toBe(false);
      expect(result.mcp.content[0].text).toBe("nested-blob");
    });

    it("condenses and redacts actual blob contents", async () => {
      const { cli, mcp } = await both(["show", "HEAD:big.txt"]);
      expect(mcp.isError).toBe(false);
      expect(cli).toContain("OUTPUT TRUNCATED");
      expect(mcp.content[0].text).toContain("lines collapsed");
      expect(cli).not.toContain(secret);
      expect(mcp.content[0].text).not.toContain(secret);
      expect(getTokenCount(mcp.content[0].text)).toBeLessThanOrEqual(1000);
    });

    it.each([
      ["show", "missing-revision"],
      ["show", "HEAD:missing.txt"],
      ["show", "filename-only"],
      ["log", "filename-only"],
      ["diff", "missing-revision"],
      ["diff", "filename-only"],
      ["diff", "--cached", "missing-revision"],
      ["diff", "missing-revision..HEAD"],
      ["diff", "HEAD~1...missing-revision"],
    ])("preserves Git failures for %j", async (...args) => {
      const { cli, mcp } = await both(args);
      expect(mcp.isError).toBe(true);
      expect(cli).toContain("FAILED: Exit");
      expect(mcp.content[0].text).not.toContain("ambiguous-filename");
    });

    it.each(["log", "diff"])(
      "preserves a non-repository failure for %s",
      async (subcommand) => {
        const empty = path.join(fixture, "not-a-repository");
        fs.ensureDirSync(empty);
        vi.spyOn(process, "cwd").mockReturnValue(empty);
        const { cli, mcp } = await both([subcommand]);
        expect(mcp.isError).toBe(true);
        expect(cli).toContain("FAILED: Exit");
        expect(mcp.content[0].text).toMatch(/not a git repository/i);
      },
    );

    it("does not invoke configured external diff or textconv programs", async () => {
      const diff = sentinel("diff");
      const conversion = sentinel("textconv");
      await fixtureGit(["config", "diff.external", shellQuote(diff.program)]);
      await fixtureGit([
        "config",
        "diff.inspect.command",
        shellQuote(diff.program),
      ]);
      await fixtureGit([
        "config",
        "diff.inspect.textconv",
        shellQuote(conversion.program),
      ]);
      fs.writeFileSync(
        path.join(workspace, ".gitattributes"),
        "file.txt diff=inspect\n",
      );
      process.env.GIT_EXTERNAL_DIFF = shellQuote(diff.program);
      const diffControl = await git([
        "--no-pager",
        "show",
        "--ext-diff",
        "--no-textconv",
        "HEAD",
        "--",
        "file.txt",
      ]);
      expect(diffControl.exitCode).toBe(0);
      expect(fs.existsSync(diff.marker)).toBe(true);
      fs.removeSync(diff.marker);
      const conversionControl = await git([
        "--no-pager",
        "show",
        "--no-ext-diff",
        "--textconv",
        "HEAD",
        "--",
        "file.txt",
      ]);
      expect(conversionControl.exitCode).toBe(0);
      expect(fs.existsSync(conversion.marker)).toBe(true);
      fs.removeSync(conversion.marker);
      for (const args of [
        ["show"],
        ["show", "-p", "HEAD", "--", "file.txt"],
        ["show", "--stat"],
        ["show", "HEAD:file.txt"],
        ["log", "-p", "-n", "1"],
        ["log", "--stat", "-n", "1"],
        ["log", "--no-patch"],
      ]) {
        const result = await both(args);
        expect(result.mcp.isError).toBe(false);
        expect(fs.existsSync(diff.marker)).toBe(false);
        expect(fs.existsSync(conversion.marker)).toBe(false);
        expect(result.mcp.content[0].text).not.toContain("SENTINEL OUTPUT");
      }
    });

    it("forces short submodule output despite configured inline diff helpers", async () => {
      const child = path.join(workspace, "child");
      const helper = sentinel("submodule-diff");
      fs.ensureDirSync(child);
      async function childGit(args: string[]) {
        const result = await execa("git", args, { cwd: child, reject: false });
        if (result.exitCode !== 0) throw new Error(result.stderr);
        return result.stdout;
      }
      await childGit(["init", "--template=", "-b", "main"]);
      await childGit(["config", "user.name", "Proxy Fixture"]);
      await childGit(["config", "user.email", "fixture@example.invalid"]);
      await childGit(["config", "commit.gpgsign", "false"]);
      fs.writeFileSync(path.join(child, "child.txt"), "child-v1\n");
      await childGit(["add", "--", "child.txt"]);
      await childGit(["commit", "-m", "CHILD_INITIAL"]);
      const first = await childGit(["rev-parse", "HEAD"]);
      fs.writeFileSync(
        path.join(workspace, ".gitmodules"),
        '[submodule "child"]\n\tpath = child\n\turl = ./child\n',
      );
      await fixtureGit(["add", "--", ".gitmodules"]);
      await fixtureGit([
        "update-index",
        "--add",
        "--cacheinfo",
        `160000,${first},child`,
      ]);
      await fixtureGit([
        "commit",
        "-m",
        "CHILD_LINK",
        "--",
        ".gitmodules",
        "child",
      ]);
      fs.writeFileSync(path.join(child, "child.txt"), "child-v2\n");
      await childGit(["add", "--", "child.txt"]);
      await childGit(["commit", "-m", "CHILD_SECOND"]);
      fs.writeFileSync(path.join(child, "child.txt"), "child-working\n");
      await childGit(["config", "diff.external", shellQuote(helper.program)]);
      await fixtureGit(["config", "diff.submodule", "diff"]);
      const control = await git([
        "--no-pager",
        "diff",
        "--submodule=diff",
        "--ext-diff",
        "--",
        "child",
      ]);
      expect(control.exitCode).toBe(0);
      expect(fs.existsSync(helper.marker)).toBe(true);
      fs.removeSync(helper.marker);
      const before = snapshotRepository();
      const result = await both(["diff", "--", "child"]);
      expect(result.mcp.isError).toBe(false);
      expect(result.mcp.content[0].text).toContain("Subproject commit");
      expect(result.mcp.content[0].text).not.toContain("child-working");
      expect(result.cli).not.toContain("SENTINEL OUTPUT");
      expect(fs.existsSync(helper.marker)).toBe(false);
      expect(snapshotRepository()).toEqual(before);
    });

    it("suppresses every configured diff helper across supported diff forms", async () => {
      const external = sentinel("diff-global");
      const driver = sentinel("diff-driver");
      const ambient = sentinel("diff-ambient");
      const conversion = sentinel("diff-conversion");
      fs.writeFileSync(path.join(workspace, "file.txt"), "sentinel-staged\n");
      await fixtureGit(["add", "--", "file.txt"]);
      fs.writeFileSync(path.join(workspace, "file.txt"), "sentinel-working\n");
      await fixtureGit([
        "config",
        "diff.external",
        shellQuote(external.program),
      ]);
      const globalControl = await git([
        "--no-pager",
        "diff",
        "--ext-diff",
        "--no-textconv",
        "--",
        "file.txt",
      ]);
      expect(globalControl.exitCode).toBe(0);
      expect(fs.existsSync(external.marker)).toBe(true);
      fs.removeSync(external.marker);
      await fixtureGit(["config", "--unset", "diff.external"]);

      fs.writeFileSync(
        path.join(workspace, ".gitattributes"),
        "file.txt diff=inspect\n",
      );
      await fixtureGit([
        "config",
        "diff.inspect.command",
        shellQuote(driver.program),
      ]);
      const driverControl = await git([
        "--no-pager",
        "diff",
        "--ext-diff",
        "--no-textconv",
        "--",
        "file.txt",
      ]);
      expect(driverControl.exitCode).toBe(0);
      expect(fs.existsSync(driver.marker)).toBe(true);
      fs.removeSync(driver.marker);
      await fixtureGit(["config", "--unset", "diff.inspect.command"]);

      process.env.GIT_EXTERNAL_DIFF = shellQuote(ambient.program);
      const ambientControl = await git([
        "--no-pager",
        "diff",
        "--ext-diff",
        "--no-textconv",
        "--",
        "file.txt",
      ]);
      expect(ambientControl.exitCode).toBe(0);
      expect(fs.existsSync(ambient.marker)).toBe(true);
      fs.removeSync(ambient.marker);
      delete process.env.GIT_EXTERNAL_DIFF;

      await fixtureGit([
        "config",
        "diff.inspect.textconv",
        shellQuote(conversion.program),
      ]);
      const conversionControl = await git([
        "--no-pager",
        "diff",
        "--no-ext-diff",
        "--textconv",
        "--",
        "file.txt",
      ]);
      expect(conversionControl.exitCode).toBe(0);
      expect(fs.existsSync(conversion.marker)).toBe(true);
      fs.removeSync(conversion.marker);

      await fixtureGit([
        "config",
        "diff.external",
        shellQuote(external.program),
      ]);
      await fixtureGit([
        "config",
        "diff.inspect.command",
        shellQuote(driver.program),
      ]);
      process.env.GIT_EXTERNAL_DIFF = shellQuote(ambient.program);
      const before = snapshotRepository();
      for (const args of [
        ["diff"],
        ["diff", "--cached"],
        ["diff", "--staged", "HEAD"],
        ["diff", "HEAD"],
        ["diff", "HEAD~1", "HEAD"],
        ["diff", "HEAD~1..HEAD"],
        ["diff", "HEAD~1...HEAD"],
        ["diff", "-p", "--", "file.txt"],
        ["diff", "--patch", "--", "file.txt"],
        ["diff", "--no-patch"],
        ["diff", "--stat"],
        ["diff", "--name-only"],
        ["diff", "--name-status"],
        ["diff", "--cached", "--stat", "--", "file.txt"],
      ]) {
        const result = await both(args);
        expect(result.mcp.isError).toBe(false);
        for (const helper of [external, driver, ambient, conversion]) {
          expect(fs.existsSync(helper.marker)).toBe(false);
        }
        expect(result.cli).not.toContain("SENTINEL OUTPUT");
        expect(result.mcp.content[0].text).not.toContain("SENTINEL OUTPUT");
        expect(snapshotRepository()).toEqual(before);
      }
    });

    it("lists local and remote branches and filters patterns without creating refs", async () => {
      await fixtureGit(["update-ref", "refs/remotes/origin/main", "HEAD"]);
      await fixtureGit([
        "update-ref",
        "refs/remotes/origin/topic",
        "feature/topic",
      ]);
      await fixtureGit(["config", "branch.feature/topic.remote", "origin"]);
      await fixtureGit([
        "config",
        "branch.feature/topic.merge",
        "refs/heads/topic",
      ]);
      const before = snapshotRepository();
      const local = await both(["branch"]);
      expect(local.mcp.isError).toBe(false);
      expect(local.mcp.content[0].text).toContain("main");
      expect(local.mcp.content[0].text).toContain("feature/topic");
      expect(local.mcp.content[0].text).not.toContain("origin/");
      for (const flag of ["--all", "-a"]) {
        const result = await both(["branch", flag]);
        expect(result.mcp.isError).toBe(false);
        expect(result.mcp.content[0].text).toContain("feature/topic");
        expect(result.mcp.content[0].text).toContain("origin/main");
      }
      for (const flag of ["--remotes", "-r"]) {
        const result = await both(["branch", flag]);
        expect(result.mcp.isError).toBe(false);
        expect(result.mcp.content[0].text).toContain("origin/topic");
        expect(result.mcp.content[0].text).not.toContain("feature/topic");
      }
      for (const pattern of ["feature/*", "feature/to?ic", "feature/[t]opic"]) {
        const result = await both(["branch", "--list", pattern]);
        expect(result.mcp.isError).toBe(false);
        expect(result.mcp.content[0].text).toContain("feature/topic");
        expect(result.mcp.content[0].text).not.toContain("main");
        expect(result.cli).toContain("feature/topic");
      }
      const multiple = await both(["branch", "-l", "--", "main", "feature/*"]);
      expect(multiple.mcp.isError).toBe(false);
      expect(multiple.mcp.content[0].text).toContain("main");
      expect(multiple.mcp.content[0].text).toContain("feature/topic");
      const remotePattern = await both([
        "branch",
        "-r",
        "--list",
        "origin/to*",
      ]);
      expect(remotePattern.mcp.isError).toBe(false);
      expect(remotePattern.mcp.content[0].text).toContain("origin/topic");
      expect(remotePattern.mcp.content[0].text).not.toContain("origin/main");
      const unmatched = await both(["branch", "--list", "new-branch"]);
      expect(unmatched.mcp.isError).toBe(false);
      expect(unmatched.mcp.content[0].text).toBe("");
      const nested = vi
        .spyOn(process, "cwd")
        .mockReturnValue(path.join(workspace, "nested"));
      const nestedResult = await both(["branch", "--list", "feature/*"]);
      expect(nestedResult.mcp.isError).toBe(false);
      expect(nestedResult.mcp.content[0].text).toContain("feature/topic");
      nested.mockReturnValue(workspace);
      expect(snapshotRepository()).toEqual(before);
    });

    it("leaves refs, reflogs, and branch configuration unchanged for every rejection", async () => {
      await fixtureGit(["update-ref", "refs/remotes/origin/main", "HEAD"]);
      await fixtureGit(["config", "branch.feature/topic.remote", "origin"]);
      await fixtureGit([
        "config",
        "branch.feature/topic.merge",
        "refs/heads/main",
      ]);
      const before = snapshotRepository();
      for (const [args, reason] of rejectedBranchRequests) {
        process.exitCode = undefined;
        const result = await both(args);
        expect(result.mcp.isError).toBe(true);
        expect(result.mcp.content[0].text).toMatch(reason);
        expect(result.cli).toBe("");
        expect(vi.mocked(console.error).mock.calls[0][0]).toBe(
          result.mcp.content[0].text,
        );
        expect(process.exitCode).toBe(1);
        expect(snapshotRepository()).toEqual(before);
      }
      for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) {
        process.env[key] = workspace;
        const result = await both(["branch", "--list", "*"]);
        expect(result.mcp.isError).toBe(true);
        expect(result.mcp.content[0].text).toMatch(/workspace override/i);
        expect(snapshotRepository()).toEqual(before);
        delete process.env[key];
      }
    }, 30000);

    it("lists an unborn repository without creating branches and reports a nonrepository failure", async () => {
      const unborn = path.join(fixture, "branch-unborn");
      const outside = path.join(fixture, "branch-nonrepository");
      fs.ensureDirSync(unborn);
      fs.ensureDirSync(outside);
      await execa("git", ["init", "--template=", "-b", "main"], {
        cwd: unborn,
      });
      const cwd = vi.spyOn(process, "cwd").mockReturnValue(unborn);
      const before = snapshotRepository(unborn);
      for (const args of [
        ["branch"],
        ["branch", "--list"],
        ["branch", "--list", "new-branch"],
        ["branch", "--all"],
        ["branch", "--remotes"],
      ]) {
        const result = await both(args);
        expect(result.mcp.isError).toBe(false);
        expect(result.mcp.content[0].text).toBe("");
        expect(snapshotRepository(unborn)).toEqual(before);
      }
      cwd.mockReturnValue(outside);
      const outsideBefore = snapshotRepository(outside);
      const result = await both(["branch"]);
      expect(result.mcp.isError).toBe(true);
      expect(result.mcp.content[0].text).toMatch(/not a git repository/i);
      expect(result.cli).toContain("FAILED: Exit");
      expect(console.error).not.toHaveBeenCalled();
      expect(snapshotRepository(outside)).toEqual(outsideBefore);
    });

    it("suppresses branch pagers in a terminal for environment and configuration controls", async () => {
      const pager = sentinel("branch-pager");
      await fixtureGit(["config", "core.pager", shellQuote(pager.program)]);
      await fixtureGit(["config", "pager.branch", shellQuote(pager.program)]);
      process.env.GIT_PAGER = shellQuote(pager.program);
      process.env.PAGER = shellQuote(pager.program);
      const controlEnv: NodeJS.ProcessEnv = { ...process.env, TERM: "xterm" };
      delete controlEnv.GIT_PAGER;
      delete controlEnv.PAGER;
      const control = await execa(
        "script",
        ["-q", "-e", "-c", "git --paginate branch --list", "/dev/null"],
        { cwd: workspace, reject: false, env: controlEnv },
      );
      expect(control.exitCode).toBe(0);
      expect(fs.existsSync(pager.marker)).toBe(true);
      fs.removeSync(pager.marker);
      const before = snapshotRepository();
      for (const args of [
        ["branch"],
        ["branch", "--list"],
        ["branch", "-l", "feature/*"],
        ["branch", "--all"],
        ["branch", "--remotes"],
        ["branch", "--verbose"],
        ["branch", "-v", "-v"],
        ["branch", "--list", "--", "feature/*"],
      ]) {
        const prepared = prepareRtkInvocation("git", args);
        const command = ["rtk", ...prepared.args].map(shellQuote).join(" ");
        for (const stripPagerEnv of [false, true]) {
          const env: NodeJS.ProcessEnv = { ...prepared.env, TERM: "xterm" };
          if (stripPagerEnv) {
            delete env.GIT_PAGER;
            delete env.PAGER;
          }
          const terminal = await execa(
            "script",
            ["-q", "-e", "-c", command, "/dev/null"],
            { cwd: prepared.cwd, reject: false, env },
          );
          expect(terminal.exitCode).toBe(0);
          expect(terminal.stdout).not.toContain("SENTINEL OUTPUT");
          expect(fs.existsSync(pager.marker)).toBe(false);
        }
        const result = await both(args);
        expect(result.mcp.isError).toBe(false);
        expect(result.cli).not.toContain("SENTINEL OUTPUT");
        expect(result.mcp.content[0].text).not.toContain("SENTINEL OUTPUT");
        expect(fs.existsSync(pager.marker)).toBe(false);
        expect(snapshotRepository()).toEqual(before);
      }
    }, 30000);

    it("suppresses configured pagers even with a terminal", async () => {
      const pager = sentinel("pager");
      for (const key of [
        "core.pager",
        "pager.status",
        "pager.log",
        "pager.show",
        "pager.diff",
      ]) {
        await fixtureGit(["config", key, shellQuote(pager.program)]);
      }
      process.env.GIT_PAGER = shellQuote(pager.program);
      process.env.PAGER = shellQuote(pager.program);
      const control = await execa(
        "script",
        ["-q", "-e", "-c", "git --paginate log -1 --oneline", "/dev/null"],
        {
          cwd: workspace,
          reject: false,
          env: { ...process.env, TERM: "xterm" },
        },
      );
      expect(control.exitCode).toBe(0);
      expect(fs.existsSync(pager.marker)).toBe(true);
      fs.removeSync(pager.marker);
      for (const args of [
        ["status", "--short"],
        ["log", "--oneline", "-n", "1"],
        ["show", "--stat"],
        ["show", "HEAD:file.txt"],
        ["diff"],
        ["diff", "--cached"],
        ["diff", "--staged", "HEAD"],
        ["diff", "HEAD~1", "HEAD"],
        ["diff", "HEAD~1...HEAD"],
      ]) {
        const prepared = prepareRtkInvocation("git", args);
        // Exercise the exact argv/env used by the common executor with a PTY.
        const command = ["rtk", ...prepared.args].map(shellQuote).join(" ");
        const result = await execa(
          "script",
          ["-q", "-e", "-c", command, "/dev/null"],
          {
            cwd: prepared.cwd,
            reject: false,
            env: { ...prepared.env, TERM: "xterm" },
          },
        );
        expect(result.exitCode).toBe(0);
        expect(fs.existsSync(pager.marker)).toBe(false);
        const adapters = await both(args);
        expect(adapters.mcp.isError).toBe(false);
        expect(fs.existsSync(pager.marker)).toBe(false);
      }
      const diffPagerEnv: NodeJS.ProcessEnv = { ...process.env, TERM: "xterm" };
      delete diffPagerEnv.GIT_PAGER;
      delete diffPagerEnv.PAGER;
      const diffPagerControl = await execa(
        "script",
        [
          "-q",
          "-e",
          "-c",
          "git --paginate diff --cached -- other.txt",
          "/dev/null",
        ],
        { cwd: workspace, reject: false, env: diffPagerEnv },
      );
      expect(diffPagerControl.exitCode).toBe(0);
      expect(fs.existsSync(pager.marker)).toBe(true);
      fs.removeSync(pager.marker);
      // Also prove --no-pager defeats config when environment suppression is absent.
      const prepared = prepareRtkInvocation("git", [
        "diff",
        "--cached",
        "--",
        "other.txt",
      ]);
      const configEnv: NodeJS.ProcessEnv = { ...prepared.env, TERM: "xterm" };
      delete configEnv.GIT_PAGER;
      delete configEnv.PAGER;
      const command = ["rtk", ...prepared.args].map(shellQuote).join(" ");
      const configured = await execa(
        "script",
        ["-q", "-e", "-c", command, "/dev/null"],
        {
          cwd: prepared.cwd,
          reject: false,
          env: configEnv,
        },
      );
      expect(configured.exitCode).toBe(0);
      expect(fs.existsSync(pager.marker)).toBe(false);
    });
  },
);
