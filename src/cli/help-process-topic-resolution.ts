import { describe, expect, it } from "vitest";
import type { HelpProcessHarness } from "./help-process-harness";
import { COMMANDS } from "./commands";

export function registerHelpProcessTopicResolutionTests(
  harness: HelpProcessHarness,
) {
  const invoke = (...args: Parameters<HelpProcessHarness["invoke"]>) =>
    harness.invoke(...args);
  describe("detailed help topic resolution", () => {
    it.each(Object.keys(COMMANDS).filter((command) => command !== "read"))(
      "resolves complete %s help without executing it",
      async (topic) => {
        const result = await invoke([topic, "--help"]);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain(`${topic} —`);
        expect(result.stdout).toContain(`Usage: spekta ${topic}`);
        expect(result.stdout).toContain("Examples:");
        expect(result.stdout).not.toContain(
          "overview; detailed command help is not yet complete",
        );
      },
      15000,
    );

    it.each([
      "ls",
      "find",
      "git",
      "git status",
      "git log",
      "git show",
      "git diff",
      "git branch",
    ])(
      "resolves %s help without executing it",
      async (topic) => {
        const parts = topic.split(" ");
        const result = await invoke([...parts, "--help"]);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain(`${topic} —`);
        expect(result.stdout).toContain(`Usage: spekta ${topic}`);
        expect(result.stdout).toContain("Usage:");
        expect(result.stdout).toContain("Examples:");
        expect(result.stdout).not.toContain(
          "overview; detailed command help is not yet complete",
        );
      },
      15000,
    );
  });
}
