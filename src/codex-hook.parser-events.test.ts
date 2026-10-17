import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  event,
  rewritten,
  shellQuoteForTest,
} from "./codex-hook.test-helpers.js";
import { rewriteEvent } from "./codex-hook.js";

describe("Codex inspection hook event contract", () => {
  it("preserves execution settings when rewriting multi-root find", () => {
    const raw = rewriteEvent({
      ...event("find src test -type f"),
      tool_input: {
        command: "find src test -type f",
        timeout: 17,
        run_in_background: false,
      },
    });
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

  it("routes mixed-root rg operands at the PreToolUse event boundary", () => {
    const raw = rewriteEvent(event("rg -e needle src/example.ts .env"));
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
