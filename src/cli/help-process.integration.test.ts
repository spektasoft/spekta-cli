import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { spawn } from "node:child_process";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
let tempRoot: string;
let entry: string;
let caseNumber = 0;

async function snapshotTree(root: string): Promise<Record<string, string>> {
  if (!(await fs.pathExists(root))) return {};
  const snapshot: Record<string, string> = {};
  for (const item of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, item.name);
    const stat = await fs.stat(file);
    snapshot[item.name] = item.isDirectory()
      ? `directory:${stat.mtimeMs}`
      : `${stat.mtimeMs}:${(await fs.readFile(file)).toString("base64")}`;
    if (item.isDirectory()) {
      for (const [name, value] of Object.entries(await snapshotTree(file))) {
        snapshot[path.join(item.name, name)] = value;
      }
    }
  }
  return snapshot;
}

beforeAll(async () => {
  tempRoot = await fs.mkdtemp(path.join(projectRoot, ".help-process-"));
  const buildDir = path.join(tempRoot, "build");
  await execa("npm", ["run", "build", "--", "--outDir", buildDir], {
    cwd: projectRoot,
  });
  entry = path.join(buildDir, "index.js");
}, 30000);

afterAll(async () => {
  if (tempRoot) await fs.remove(tempRoot);
});

async function invoke(args: string[], seeded = false, operational = false) {
  const root = path.join(tempRoot, `case-${++caseNumber}`);
  const workspace = path.join(root, "workspace");
  const home = path.join(root, "home");
  const tmp = path.join(root, "tmp");
  const stdoutPath = path.join(root, "stdout.txt");
  const stderrPath = path.join(root, "stderr.txt");
  await fs.ensureDir(workspace);
  await fs.ensureDir(tmp);
  if (operational) {
    await fs.writeFile(path.join(workspace, "--help"), "literal-help-file\n");
    await fs.writeFile(path.join(workspace, "-h"), "literal-short-help-file\n");
    await fs.writeFile(
      path.join(workspace, "existing.ts"),
      "const keep = true;\n",
    );
  }
  if (seeded) {
    await fs.outputFile(
      path.join(home, ".spekta", ".env"),
      "SPEKTA_EDITOR=missing-editor\n",
    );
    await fs.outputFile(
      path.join(home, ".spekta", "providers.yaml"),
      "invalid: [\n",
    );
    await fs.outputFile(
      path.join(home, ".codex", "hooks.json"),
      "not valid JSON\n",
    );
    await fs.outputFile(
      path.join(home, ".codex", "AGENTS.md"),
      "Personal instructions\n",
    );
    await fs.outputFile(
      path.join(home, ".codex", "config.toml"),
      "personal = true\n",
    );
    await fs.writeFile(
      path.join(workspace, "existing.ts"),
      "Keep this content\n",
    );
    await fs.writeFile(
      path.join(workspace, ".env"),
      "SPEKTA_READ_TOKEN_LIMIT=invalid\n",
    );
  }
  const homeBefore = await snapshotTree(home);
  const workspaceBefore = await snapshotTree(workspace);
  const stdoutFd = fs.openSync(stdoutPath, "w");
  const stderrFd = fs.openSync(stderrPath, "w");
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: workspace,
    env: {
      HOME: home,
      SPEKTA_HOME_OVERRIDE: path.join(home, ".spekta"),
      SPEKTA_ASSET_ROOT_OVERRIDE: operational
        ? path.dirname(entry)
        : path.join(root, "missing-assets"),
      PATH: "",
      TMPDIR: tmp,
      NO_COLOR: "1",
    },
    // Regular files also capture output on hosts where Node treats child
    // process socket descriptors as an unsupported stdout handle.
    stdio: ["pipe", stdoutFd, stderrFd],
  });
  let exitCode: number | null;
  try {
    exitCode = await new Promise<number | null>((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, 5000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (timedOut)
          reject(new Error(`CLI did not terminate: ${args.join(" ")}`));
        else resolve(code);
      });
      child.stdin?.end();
    });
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
  expect(await fs.pathExists(home)).toBe(seeded);
  expect(await snapshotTree(home)).toEqual(homeBefore);
  expect(await snapshotTree(workspace)).toEqual(workspaceBefore);
  expect(await fs.readdir(tmp)).toEqual([]);
  return {
    exitCode,
    stdout: await fs.readFile(stdoutPath, "utf8"),
    stderr: await fs.readFile(stderrPath, "utf8"),
  };
}

describe("CLI help before initialization", () => {
  it.each([
    ["./--help", "literal-help-file"],
    ["./-h", "literal-short-help-file"],
  ])("reads the literal help-looking path %s", async (file, content) => {
    const result = await invoke(["read", file], false, true);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(content);
    expect(result.stdout).not.toContain("Usage:");
  });

  it.each([
    ["write", "new.ts", "--help"],
    ["replace", "existing.ts", "-h"],
    ["commit", "--model", "--help"],
    ["prompt", "--output", "--help"],
    ["prompt", "--include-partial", "--help"],
    ["prompt", "--exclude-partial", "--help"],
    ["grep", "--help", "existing.ts"],
    ["grep", "pattern", "--glob", "-h"],
    ["find", ".", "-name", "--help"],
    ["find", ".", "-type", "-h"],
    ["git", "log", "-n", "-h"],
    ["git", "status", "--", "--help"],
    ["read", "--", "--help"],
  ])("preserves help-looking data and values in %j", async (...args) => {
    const result = await invoke(args, false, true);
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).not.toBe("");
    expect(result.stdout).not.toContain("Usage: spekta");
    expect(result.stderr).not.toContain("Unknown help topic");
    expect(result.stderr).not.toContain("Critical Error");
  });

  it.each(["-h", "help"])("supports the global %s alias", async (alias) => {
    const result = await invoke([alias]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Built-in commands:");
    expect(result.stdout).toContain("Supported proxy families:");
  });

  it.each([
    ["read", "-h"],
    ["help", "read"],
    ["read", "--help", "--save"],
    ["read", "existing.ts[1,5]", "--save", "--help"],
  ])("supports read help via %j", async (...args) => {
    const result = await invoke(args, true);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("read — Read eligible workspace files");
    expect(result.stdout).toContain("Examples:");
  });

  it.each([
    "commit",
    "repl",
    "prompt",
    "review",
    "grep",
    "diagnostic",
    "pr",
    "commit-range",
    "summarize",
    "sync",
    "replace",
    "write",
    "mcp",
    "setup",
    "uninstall",
    "status",
    "ls",
    "find",
    "git",
    "git status",
    "git log",
    "git show",
    "git diff",
    "git branch",
  ])(
    "resolves all aliases for the %s overview without executing it",
    async (topic) => {
      const parts = topic.split(" ");
      for (const args of [
        [...parts, "--help"],
        [...parts, "-h"],
        ["help", ...parts],
      ]) {
        const result = await invoke(args);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain(`${topic} —`);
        expect(result.stdout).toContain(`Usage: spekta ${topic}`);
        expect(result.stdout).toContain("overview");
      }
    },
    15000,
  );

  it.each([
    ["setup", "--global", "--codex", "--apply", "--mcp", "--help"],
    ["uninstall", "--global", "--codex", "--apply", "-h"],
    ["commit", "--commit", "--model", "missing-model", "--help"],
    ["mcp", "--help"],
  ])("preserves seeded configuration for %j", async (...args) => {
    const result = await invoke(args, true);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`Usage: spekta ${args[0]}`);
  });

  it("rejects explicit unknown topics without bootstrap or proxy execution", async () => {
    for (const args of [
      ["help", "unknown-tool"],
      ["unknown-tool", "--help"],
      ["help", "git", "push"],
      ["git", "push", "-h"],
      ["help", "read", "extra"],
    ]) {
      const result = await invoke(args);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Unknown help topic");
      expect(result.stderr).toContain("spekta --help");
      expect(result.stderr).not.toMatch(
        /Critical Error|Execution refused|ENOENT/,
      );
    }
  }, 15000);

  it("explains read operands, ranges, saving, budgets and policy", async () => {
    const result = await invoke(["read", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    for (const text of [
      "Usage: spekta read",
      "[start,end]",
      "--save",
      "SPEKTA_EDITOR",
      "SPEKTA_READ_TOKEN_LIMIT",
      "1000",
      "SPEKTA_COMPACT_THRESHOLD",
      "500",
      "response budget",
      "incomplete",
      "10 MB",
      ".env",
      ".gitignore",
      ".spektaignore",
      "symlink",
      "interactive",
      "Examples:",
      "spekta read 'src/index.ts[10,20]'",
      "./--help",
    ])
      expect(result.stdout).toContain(text);
  });

  it("prints all native commands and proxy families without assets, credentials or backends", async () => {
    const result = await invoke(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: spekta");
    for (const command of [
      "commit",
      "repl",
      "prompt",
      "review",
      "read",
      "grep",
      "diagnostic",
      "pr",
      "commit-range",
      "summarize",
      "sync",
      "replace",
      "write",
      "mcp",
      "setup",
      "uninstall",
      "status",
      "ls",
      "find",
      "git",
    ]) {
      expect(result.stdout).toMatch(new RegExp(`^  ${command}\\s`, "m"));
    }
    expect(result.stdout).toContain("spekta help <command>");
  });
});
