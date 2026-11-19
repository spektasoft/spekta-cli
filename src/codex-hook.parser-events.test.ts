import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  event,
  rewritten,
  shellQuoteForTest,
} from "./codex-hook.test-helpers.js";
import { rewriteEvent } from "./codex-hook.js";

function shellAvailable(shell: string): boolean {
  const resolver = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(resolver, [shell], { encoding: "utf8" });
  if (result.error) {
    throw new Error(
      `Failed to check whether ${shell} is available using ${resolver}: ${result.error.message}`,
      { cause: result.error },
    );
  }
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(
    `Could not determine whether ${shell} is available using ${resolver}: exited with status ${result.status}; ${result.stderr}`,
  );
}

describe("Codex inspection hook event contract", () => {
  it("preserves execution settings when rewriting multi-root find", () => {
    const raw = rewriteEvent(
      {
        ...event("find src test -type f"),
        tool_input: {
          command: "find src test -type f",
          timeout: 17,
          run_in_background: false,
        },
      },
      "linux",
    );
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!) as {
      hookSpecificOutput: { updatedInput: Record<string, unknown> };
    };
    expect(parsed.hookSpecificOutput.updatedInput).toEqual({
      command: "'spekta' 'find' 'src' 'test' '-type' 'f'",
      timeout: 17,
      run_in_background: false,
    });
  });

  it("returns only the documented response and ignores unrelated fields", () => {
    const raw = rewriteEvent(event("ls"), "linux");
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

  it("routes mixed-root rg operands at the PreToolUse event boundary", () => {
    const raw = rewriteEvent(
      event("rg -e needle src/example.ts .env"),
      "linux",
    );
    expect(raw).toBe(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: {
            command: "'spekta' 'rg' '-e' 'needle' 'src/example.ts' '.env'",
          },
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
    const raw = rewriteEvent(
      {
        ...event("cat README.md"),
        tool_input: originalInput,
      },
      "linux",
    );
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
    expect(() => rewriteEvent(input, "linux")).toThrow(),
  );

  it("ignores valid unrelated event names", () => {
    expect(
      rewriteEvent({ ...event("ls"), tool_name: "Other" }, "linux"),
    ).toBeUndefined();
    expect(
      rewriteEvent({ ...event("ls"), hook_event_name: "Other" }, "linux"),
    ).toBeUndefined();
  });

  it.skipIf(!shellAvailable("bash"))(
    "bash parses serialized operands as one literal argument",
    () => assertShellSerialization("bash"),
  );

  it.skipIf(!shellAvailable("zsh"))(
    "zsh parses serialized operands as one literal argument",
    () => assertShellSerialization("zsh"),
  );

  it("dispatches to PowerShell with PowerShell quoting and preserves input fields", () => {
    const originalInput = {
      command: "Get-ChildItem -LiteralPath 'space name' -Name",
      timeout: 17,
      env: { SPEKTA_TEST: "kept" },
    };
    const raw = rewriteEvent(
      {
        ...event(originalInput.command),
        tool_input: originalInput,
      },
      "win32",
    );
    const parsed = JSON.parse(raw!) as {
      hookSpecificOutput: { updatedInput: Record<string, unknown> };
    };
    expect(parsed.hookSpecificOutput.updatedInput).toEqual({
      ...originalInput,
      command: "& 'spekta.cmd' 'ls' 'space name'",
    });
  });
});

function assertShellSerialization(shell: string): void {
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
}
