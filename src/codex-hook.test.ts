import { spawnSync, spawn } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { rewriteEvent } from "./codex-hook.js";

const event = (command: string) => ({
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  cwd: process.cwd(),
  tool_input: { command },
  ignored: true,
});

function rewritten(command: string): string | undefined {
  const output = rewriteEvent(event(command));
  if (!output) return;
  const parsed: unknown = JSON.parse(output);
  if (!parsed || typeof parsed !== "object")
    throw new Error("invalid hook output");
  const specific = (
    parsed as { hookSpecificOutput?: { updatedInput?: { command?: unknown } } }
  ).hookSpecificOutput;
  const value = specific?.updatedInput?.command;
  return typeof value === "string" ? value : undefined;
}

const hookBin = join(process.cwd(), "dist", "codex-hook.js");
const inputFor = (command: string) => JSON.stringify(event(command));

beforeAll(() => {
  const build = spawnSync("npm", ["run", "build"], { encoding: "utf8" });
  if (build.status !== 0) {
    throw new Error(
      `Failed to build Codex inspection hook:\n${build.stderr || build.stdout}`,
    );
  }
  chmodSync(hookBin, 0o755);
});

describe("Codex inspection hook parser", () => {
  it.each([
    ["ls", "'spekta' 'ls'"],
    ["ls src", "'spekta' 'ls' 'src'"],
    ["find", "'spekta' 'find'"],
    [
      "find src -type f -name '*.ts'",
      "'spekta' 'find' 'src' '-type' 'f' '-name' '*.ts'",
    ],
    ["find -name 'literal ; *.ts'", "'spekta' 'find' '-name' 'literal ; *.ts'"],
    [
      "find ../outside -name '*.ts'",
      "'spekta' 'find' '../outside' '-name' '*.ts'",
    ],
    ["ls 'a b'", "'spekta' 'ls' 'a b'"],
    ["ls '日本語'", "'spekta' 'ls' '日本語'"],
    ["ls 'a'\\''b'", "'spekta' 'ls' 'a'\\''b'"],
    ["ls 'a;|*?$'", "'spekta' 'ls' 'a;|*?$'"],
    ["ls a\\ b", "'spekta' 'ls' 'a b'"],
    ["l's'\"\"", "'spekta' 'ls'"],
    ["ls\tfoo", "'spekta' 'ls' 'foo'"],
    ["ls 'a b'", "'spekta' 'ls' 'a b'"],
    ['ls "a\\qb"', "'spekta' 'ls' 'a\\qb'"],
    ['ls "a\\"b"', "'spekta' 'ls' 'a\"b'"],
    ['ls "a\\$b\\`c\\\\d"', "'spekta' 'ls' 'a$b`c\\d'"],
    ['ls "a;|*?[]{}()<>!#~"', "'spekta' 'ls' 'a;|*?[]{}()<>!#~'"],
  ])("rewrites literal %s", (input, expected) =>
    expect(rewritten(input)).toBe(expected),
  );

  it.each([
    ["git status --short", "'spekta' 'git' 'status' '--short'"],
    ["git diff --stat HEAD", "'spekta' 'git' 'diff' '--stat' 'HEAD'"],
    ["git log --stat -n 2", "'spekta' 'git' 'log' '--stat' '-n' '2'"],
    ["git show --stat HEAD", "'spekta' 'git' 'show' '--stat' 'HEAD'"],
    ["git branch --list", "'spekta' 'git' 'branch' '--list'"],
    ["git diff -- 'space name'", "'spekta' 'git' 'diff' '--' 'space name'"],
    [
      "git log --stat -- README.md",
      "'spekta' 'git' 'log' '--stat' '--' 'README.md'",
    ],
  ])("routes supported Git inspection %s", (input, expected) =>
    expect(rewritten(input)).toBe(expected),
  );

  it.each([
    ["cat README.md", "'spekta' 'read' 'README.md'"],
    ["cat 'path with spaces.md'", "'spekta' 'read' 'path with spaces.md'"],
    ["cat 'quote'\\''and;*.md'", "'spekta' 'read' 'quote'\\''and;*.md'"],
    ["sed -n '2,4p' README.md", "'spekta' 'read' 'README.md[2,4]'"],
    ["sed -n '7,$p' README.md", "'spekta' 'read' 'README.md[7,$]'"],
  ])("routes representable read %s", (input, expected) =>
    expect(rewritten(input)).toBe(expected),
  );

  it.each([
    "ls -a",
    "cat",
    "cat -n README.md",
    "cat README.md other.md",
    "cat -",
    "cat README.md | head",
    "cat $HOME",
    "cat *.md",
    "sed -n '1,4p' README.md extra.md",
    "sed -e 'p' README.md",
    "sed -n '0,4p' README.md",
    "sed -n '5,4p' README.md",
    "sed -n '2,4p' 'README.md[1,3]'",
    "sed -n '1,4d' README.md",
    "sed -n '1,4p'",
    "sed -n '1,4p' -",
    "cat 'README.md[2,4]'",
    "ls --",
    "ls a b",
    "ls;whoami",
    "ls | cat",
    "ls >file",
    "ls #comment",
    "ls $(id)",
    "ls `id`",
    "ls $HOME",
    "ls *.ts",
    "ls a?",
    "ls [ab]",
    "ls {a,b}",
    "ls && true",
    "A=1 ls",
    "command ls",
    "bash -c ls",
    "spekta ls",
    "spekta read README.md",
    "spekta find .",
    "rtk ls",
    "rtk find .",
    "find src -exec cat {} \\;",
    "find src -maxdepth 2",
    "git status --ignored",
    "git log --oneline -n 1",
    "git commit -m message",
    "git diff -- src | cat",
    "git status && git diff",
    "npm test",
    "npm run build",
    "ls 'unterminated",
    'ls "x$HOME"',
    'ls "x`id`"',
    'ls "x\\"',
    "ls\\\nfoo",
    "ls\nfoo",
    "ls\rfoo",
    "ls\u0001foo",
  ])("does not rewrite excluded syntax: %s", (input) =>
    expect(rewritten(input)).toBeUndefined(),
  );

  it("returns only the documented response and ignores unrelated fields", () => {
    const raw = rewriteEvent(event("ls"));
    expect(raw).toBe(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: { command: "'spekta' 'ls'" },
        },
      }),
    );
  });

  it("preserves every execution setting while changing only the command", () => {
    const originalInput = {
      command: "cat README.md",
      cwd: "/other/worktree",
      env: { SPEKTA_TEST: "kept" },
      max_output_tokens: 1234,
      yield_time_ms: 876,
      opaque_runtime_option: { nested: true },
    };
    const raw = rewriteEvent({
      ...event("cat README.md"),
      tool_input: originalInput,
    });
    expect(raw).toBe(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: {
            ...originalInput,
            command: "'spekta' 'read' 'README.md'",
          },
        },
      }),
    );
  });

  it.each([
    null,
    [],
    {},
    { ...event("ls"), cwd: 4 },
    { ...event("ls"), tool_input: {} },
    { ...event("ls"), hook_event_name: undefined },
    { ...event("ls"), tool_name: 9 },
  ])("rejects malformed event shapes", (input) =>
    expect(() => rewriteEvent(input)).toThrow(),
  );

  it("ignores valid unrelated event names", () => {
    expect(
      rewriteEvent({ ...event("ls"), tool_name: "Other" }),
    ).toBeUndefined();
    expect(
      rewriteEvent({ ...event("ls"), hook_event_name: "Other" }),
    ).toBeUndefined();
  });

  it.each(["bash", "zsh"])(
    "%s parses serialized operands as one literal argument",
    (shell) => {
      const resolved = spawnSync("which", [shell], { encoding: "utf8" });
      if (resolved.status !== 0) return;
      const cases = [
        "space name",
        "日本語",
        "quote'and\\slash",
        "semi;glob* dollar$",
      ];
      for (const value of cases) {
        const serialized = rewritten(`ls ${shellQuoteForTest(value)}`);
        if (!serialized) throw new Error("expected rewrite");
        const operand = serialized.split(" ").slice(2).join(" ");
        const result = spawnSync(shell, ["-c", `printf '%s' ${operand}`], {
          encoding: "utf8",
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toBe(value);
      }
    },
  );
});

function shellQuoteForTest(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

describe("built Codex inspection hook", () => {
  it("runs directly and through a symlink with one generated shebang", () => {
    const dir = mkdtempSync(join(tmpdir(), "spekta-hook-"));
    try {
      const link = join(dir, "hook");
      symlinkSync(hookBin, link);
      const source = readFileSync(hookBin, "utf8");
      expect(source.match(/^#!.*$/gm)).toHaveLength(1);
      for (const executable of [hookBin, link]) {
        const result = spawnSync(executable, [], {
          input: inputFor("ls 'quoted path'"),
          encoding: "utf8",
          timeout: 4_000,
        });
        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout, JSON.stringify(result)).toBe(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "allow",
              updatedInput: { command: "'spekta' 'ls' 'quoted path'" },
            },
          }) + "\n",
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["invalid JSON", "{"],
    ["oversized input", "x".repeat(65 * 1024)],
  ])("diagnoses %s on stderr with empty stdout", (_label, input) => {
    const result = spawnSync(hookBin, [], {
      input,
      encoding: "utf8",
      timeout: 4_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^spekta-codex-hook: .+\n$/);
  });

  it("times out on open stdin and exits promptly", async () => {
    const child = spawn(hookBin, [], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const status = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("hook did not terminate"));
      }, 3_500);
      child.once("error", reject);
      child.once("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    expect(status).toBe(0);
    expect(Buffer.concat(stdout).toString()).toBe("");
    expect(Buffer.concat(stderr).toString()).toMatch(
      /^spekta-codex-hook: input timeout\n$/,
    );
  });

  it("does not execute pending shell text or alter workspace/home contents", () => {
    const dir = mkdtempSync(join(tmpdir(), "spekta-hook-"));
    const marker = join(dir, "started");
    const before = readFileSync(join(process.cwd(), "README.md"), "utf8");
    try {
      const command = `ls; touch '${marker}'`;
      const result = spawnSync(hookBin, [], {
        input: inputFor(command),
        encoding: "utf8",
        timeout: 4_000,
      });
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(readFileSync(join(process.cwd(), "README.md"), "utf8")).toBe(
        before,
      );
      expect(() => readFileSync(marker)).toThrow();
      expect(readFileSync(join(process.cwd(), "README.md"), "utf8")).toBe(
        before,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
