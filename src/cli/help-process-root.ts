import { describe, expect, it } from "vitest";
import type { HelpProcessHarness } from "./help-process-harness";
import { COMMANDS } from "./commands";
import { NATIVE_HELP } from "./help-native";

export function registerHelpProcessRootTests(harness: HelpProcessHarness) {
  const invoke = (...args: Parameters<HelpProcessHarness["invoke"]>) =>
    harness.invoke(...args);
  describe("root help completeness", () => {
    it("has complete help for every registered native command", () => {
      expect(Object.keys(NATIVE_HELP).sort()).toEqual(
        Object.keys(COMMANDS).sort(),
      );
      expect(Object.values(NATIVE_HELP).every((topic) => topic.complete)).toBe(
        true,
      );
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
        "rg",
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
}
