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
      fs.writeFileSync(path.join(workspace, "file.txt"), "working-copy\n");
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
        const history = args[0] !== "status";
        // Independent reference from the user grammar, not from prepareRtkInvocation.
        const reference = await git([
          "--no-pager",
          "--literal-pathspecs",
          args[0],
          ...(history ? ["--no-ext-diff", "--no-textconv"] : []),
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
    ])("preserves Git failures for %j", async (...args) => {
      const { cli, mcp } = await both(args);
      expect(mcp.isError).toBe(true);
      expect(cli).toContain("FAILED: Exit");
      expect(mcp.content[0].text).not.toContain("ambiguous-filename");
    });

    it("preserves a non-repository execution failure", async () => {
      const empty = path.join(fixture, "not-a-repository");
      fs.ensureDirSync(empty);
      vi.spyOn(process, "cwd").mockReturnValue(empty);
      const { cli, mcp } = await both(["log"]);
      expect(mcp.isError).toBe(true);
      expect(cli).toContain("FAILED: Exit");
      expect(mcp.content[0].text).toMatch(/not a git repository/i);
    });

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

    it("suppresses configured pagers even with a terminal", async () => {
      const pager = sentinel("pager");
      for (const key of [
        "core.pager",
        "pager.status",
        "pager.log",
        "pager.show",
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
      // Also prove --no-pager defeats config when environment suppression is absent.
      const prepared = prepareRtkInvocation("git", [
        "log",
        "--oneline",
        "-n",
        "1",
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
