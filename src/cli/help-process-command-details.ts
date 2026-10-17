import { describe, expect, it } from "vitest";
import type { HelpProcessHarness } from "./help-process-harness";

export function registerHelpProcessCommandDetailsTests(
  harness: HelpProcessHarness,
) {
  const invoke = (...args: Parameters<HelpProcessHarness["invoke"]>) =>
    harness.invoke(...args);
  describe("detailed native command help", () => {
    it.each([
      [
        "commit",
        [
          "prompt-only",
          "--message",
          "--commit",
          "--model",
          "--stdout",
          "--no-editor",
          "--interactive",
          "temporary file",
          "without opening an editor",
        ],
      ],
      [
        "prompt",
        [
          "--include-partial",
          "--exclude-partial",
          "--output",
          "--stdout",
          "--no-editor",
        ],
      ],
      [
        "rg",
        [
          "PATTERN",
          "first positional operand is the regex",
          "smart-case",
          "--glob",
          "--ignore-case",
          "SPEKTA_GREP_TOKEN_LIMIT",
          "2000",
          "Overflow withholds every match",
        ],
      ],
      [
        "write",
        ["stdin", "never overwritten", "Help exits before reading stdin"],
      ],
      [
        "replace",
        [
          "SEARCH/REPLACE",
          "stdin",
          "50 blocks",
          "Help exits before reading stdin",
        ],
      ],
      [
        "setup",
        [
          "--global --codex",
          "--dry-run|--apply",
          "--mcp",
          "runtime activation",
        ],
      ],
      [
        "uninstall",
        [
          "--global --codex",
          "--dry-run|--apply",
          "does not uninstall the Spekta CLI",
        ],
      ],
      [
        "mcp",
        [
          "long-lived",
          "standard input and output",
          "Help exits before initialization",
        ],
      ],
    ])("documents actual %s behavior", async (command, requiredText) => {
      const result = await invoke([command, "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      for (const text of requiredText) expect(result.stdout).toContain(text);
    });
  });
}
