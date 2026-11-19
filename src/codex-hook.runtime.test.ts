import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { inputFor, shellQuoteForTest } from "./codex-hook.test-helpers.js";

const hookBin = join(process.cwd(), "dist", "codex-hook.js");
const hookExecutable = process.platform === "win32" ? process.execPath : hookBin;
const hookArguments = process.platform === "win32" ? [hookBin] : [];

beforeAll(() => {
  const build = spawnSync("npm", ["run", "build"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (build.status !== 0 || build.error) {
    let timeoutCleanup = "";
    if (process.platform === "win32" && build.error?.code === "ETIMEDOUT") {
      if (typeof build.pid === "number" && build.pid > 0) {
        const cleanup = spawnSync(
          "taskkill.exe",
          ["/PID", String(build.pid), "/T", "/F"],
          { encoding: "utf8", timeout: 10_000 },
        );
        timeoutCleanup = `; owned build tree cleanup exit ${cleanup.status ?? "null"}: ${cleanup.error?.message ?? cleanup.stderr ?? ""}`;
      } else {
        timeoutCleanup = "; no build PID was available for process-tree cleanup";
      }
    }
    throw new Error(
      `Failed to build Codex inspection hook (status ${build.status ?? "null"}): ${build.error?.message ?? ""}${timeoutCleanup}\n${build.stderr || build.stdout}`,
    );
  }
  if (process.platform !== "win32") chmodSync(hookBin, 0o755);
}, 130_000);

describe("built Codex inspection hook", () => {
  it("runs directly and through a symlink with one generated shebang", () => {
    const dir = mkdtempSync(join(tmpdir(), "spekta-hook-"));
    try {
      const link = join(dir, "hook");
      if (process.platform !== "win32") symlinkSync(hookBin, link);
      const source = readFileSync(hookBin, "utf8");
      expect(source.match(/^#!.*$/gm)).toHaveLength(1);
      const executables =
        process.platform === "win32"
          ? [[hookExecutable, hookArguments] as const]
          : [
              [hookBin, []] as const,
              [link, []] as const,
            ];
      const command =
        process.platform === "win32"
          ? "Get-Content -LiteralPath 'quoted path'"
          : "ls 'quoted path'";
      const rewrittenCommand =
        process.platform === "win32"
          ? "& 'spekta.cmd' 'read' 'quoted path'"
          : "'spekta' 'ls' 'quoted path'";
      for (const [executable, args] of executables) {
        const result = spawnSync(executable, args, {
          input: inputFor(command),
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
              updatedInput: { command: rewrittenCommand },
            },
          }) + "\n",
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform !== "win32")(
    "executes its native PowerShell rewrite through the host shell",
    () => {
      const root = mkdtempSync(join(tmpdir(), "spekta-hook-powershell-"));
      const bin = join(root, "bin");
      const workspace = join(root, "workspace with spaces");
      const marker = "SPEKTA_POWERSHELL_EXECUTION_FIXTURE";
      const secondLine = "SECOND_LINE_MUST_NOT_BE_READ";
      try {
        mkdirSync(bin, { recursive: true });
        mkdirSync(workspace, { recursive: true });
        writeFileSync(
          join(workspace, "smoke note.txt"),
          `${marker}\n${secondLine}\n`,
          { flag: "wx" },
        );
        const git = spawnSync("git.exe", ["init", "--quiet"], {
          cwd: workspace,
          encoding: "utf8",
          timeout: 10_000,
        });
        expect(git.status, git.stderr || git.error?.message).toBe(0);
        writeFileSync(
          join(bin, "spekta.cmd"),
          "@echo off\r\n\"%SPEKTA_TEST_NODE%\" \"%SPEKTA_TEST_DIST%\" %*\r\n",
          { flag: "wx" },
        );
        writeFileSync(join(bin, "spekta.ps1"), "throw 'wrong shim selected'\r\n", {
          flag: "wx",
        });

        const event = {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          cwd: workspace,
          model: "gpt-6-luna",
          tool_input: {
            command: "Get-Content -LiteralPath 'smoke note.txt' -TotalCount 1",
          },
        };
        const hook = spawnSync(process.execPath, [hookBin], {
          input: JSON.stringify(event),
          encoding: "utf8",
          timeout: 4_000,
        });
        expect(hook.status, hook.stderr || hook.error?.message).toBe(0);
        expect(hook.stderr).toBe("");
        const response = JSON.parse(hook.stdout);
        const rewrittenCommand =
          response.hookSpecificOutput.updatedInput.command as string;

        const execution = spawnSync(
          "powershell.exe",
          ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", rewrittenCommand],
          {
            cwd: workspace,
            env: {
              ...process.env,
              PATH: `${bin};${process.env.PATH ?? ""}`,
              SPEKTA_TEST_NODE: process.execPath,
              SPEKTA_TEST_DIST: join(process.cwd(), "dist", "index.js"),
            },
            encoding: "utf8",
            timeout: 20_000,
          },
        );

        expect(
          execution.status,
          `command=${rewrittenCommand}\nstdout=${execution.stdout}\nstderr=${execution.stderr}\nerror=${execution.error?.message ?? ""}`,
        ).toBe(0);
        expect(execution.stderr).toBe("");
        expect(execution.stdout).toContain(marker);
        expect(execution.stdout).not.toContain(secondLine);
        expect(rewrittenCommand).toBe(
          "& 'spekta.cmd' 'read' 'smoke note.txt[1,1]'",
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ["invalid JSON", "{"],
    ["oversized input", "x".repeat(65 * 1024)],
  ])("diagnoses %s on stderr with empty stdout", (_label, input) => {
    const result = spawnSync(hookExecutable, hookArguments, {
      input,
      encoding: "utf8",
      timeout: 4_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^spekta-codex-hook: .+\n$/);
  });

  it("times out on open stdin and exits promptly", async () => {
    const child = spawn(hookExecutable, hookArguments, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const status = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("hook did not terminate"));
      }, 10_000);
      child.once("error", reject);
      child.once("close", (code) => {
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
      const result = spawnSync(process.execPath, [hookBin], {
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

  it("leaves external skill, temporary, and explicit RTK commands to the shell", () => {
    const homeSkill = join(
      homedir(),
      ".codex",
      "skills",
      "fixture",
      "SKILL.md",
    );
    const temporary = join(tmpdir(), "fixture with [special] name.md");
    for (const command of [
      `cat ${shellQuoteForTest(homeSkill)}`,
      `rg -e needle ${shellQuoteForTest(temporary)}`,
      `rtk rg needle ${shellQuoteForTest(homeSkill)}`,
    ]) {
      const result = spawnSync(process.execPath, [hookBin], {
        input: inputFor(command),
        encoding: "utf8",
        timeout: 4_000,
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("");
    }
  });
});
