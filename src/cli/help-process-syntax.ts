import { describe, expect, it } from "vitest";
import type { HelpProcessHarness } from "./help-process-harness";

export function registerHelpProcessSyntaxTests(harness: HelpProcessHarness) {
  const invoke = (...args: Parameters<HelpProcessHarness["invoke"]>) =>
    harness.invoke(...args);
  describe("detailed help syntax and policy", () => {
    it.each([
      [
        "ls",
        [
          "spekta ls [--allowance <tokens>] [directory...]",
          "one or more literal directory paths",
          "no directory, ls lists .",
          "no eligible entries in this listing",
          "marked incomplete",
          "SPEKTA_LIST_TOKEN_LIMIT (1000)",
          "SPEKTA_LIST_TOKEN_CEILING (8000)",
          "spekta ls src",
        ],
      ],
      [
        "find",
        [
          "zero or more roots before the first predicate",
          "No roots means .",
          "duplicate roots are preserved",
          "Relative parent references and POSIX absolute roots",
          "-type f",
          "-type d",
          "-name pattern",
          "--help, --allowance, and -exec remain pattern values",
          "-print",
          "Use -type and -name together",
          "Quote shell globs",
          "physical -P traversal",
          "No eligible paths in this discovery.",
          "minimum allowance is measured from the complete transport-specific validation response",
          "that validation response uses the configured default budget, not the rejected allowance",
          "rejected-request response exceeds the default",
          "shorten an unusually long MCP request ID if needed",
          "Accepted discovery responses always fit their requested allowance",
          "SPEKTA_LIST_TOKEN_LIMIT (1000)",
          "SPEKTA_LIST_TOKEN_CEILING (8000)",
          "complete formatted CLI response or MCP JSON-RPC envelope",
          "The CLI allowance must be the first argument after find",
          "Linux or WSL with GNU Findutils",
          "spekta find --allowance 2000 src test -type f -name '*.ts'",
          "spekta find . -type f -name '*.ts'",
        ],
      ],
      [
        "git",
        [
          "Supported subcommands",
          "status lists",
          "log lists",
          "show inspects",
          "diff inspects",
          "branch lists",
          "Unsupported native Git options",
          "mutating commands",
        ],
      ],
      [
        "git status",
        [
          "--short",
          "--branch",
          "--porcelain=v1",
          "--porcelain=v2",
          "--untracked-files=no|normal|all",
          "Path operands follow --",
          "eligible paths",
          "configured Git response budget",
          "spekta git status --short -- 'src/file name.ts'",
        ],
      ],
      [
        "git log",
        [
          "-n <positive-count>",
          "--max-count=<positive-count>",
          "--patch",
          "--stat",
          "--name-only",
          "--name-status",
          "A log revision may also use one .. or ... range",
          "path operands follow --",
          "defaults to 10 commits",
          "configured Git response budget",
          "spekta git log --stat main..HEAD -- 'src/file name.ts'",
        ],
      ],
      [
        "git show",
        [
          "at most one revision",
          "revision:path",
          "--patch",
          "--stat",
          "--name-only",
          "--name-status",
          "workspace paths follow it",
          "Eligible files",
          "configured Git response budget",
          "spekta git show HEAD:src/file.ts",
        ],
      ],
      [
        "git diff",
        [
          "--cached",
          "--staged",
          "--patch",
          "--stat",
          "--name-only",
          "--name-status",
          "accepts up to two revisions",
          "range is allowed only as the sole revision operand",
          "Optional path operands follow --",
          "Eligible files",
          "configured Git response budget",
          "spekta git diff main...HEAD -- 'src/file name.ts'",
        ],
      ],
      [
        "git branch",
        [
          "listing-only",
          "--list",
          "--all",
          "--remotes",
          "--verbose",
          "A pattern requires explicit --list",
          "separates options from patterns",
          "branch names only",
          "configured Git response budget",
          "spekta git branch --list 'feature/*'",
        ],
      ],
    ])(
      "documents accepted syntax and policy for %s",
      async (topic, required) => {
        const result = await invoke(["help", ...topic.split(" ")]);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        for (const text of required) expect(result.stdout).toContain(text);
      },
    );
  });
}
