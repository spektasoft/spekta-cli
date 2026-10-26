import { describe, expect, it } from "vitest";
import { event, rewritten } from "./codex-hook.test-helpers.js";
import { rewriteEvent } from "./codex-hook.js";

describe.skipIf(process.platform === "win32")(
  "Codex inspection hook Bash regressions",
  () => {
    it.each([
      ["ls src", "'spekta' 'ls' 'src'"],
      ["find src -type f", "'spekta' 'find' 'src' '-type' 'f'"],
      ["cat README.md", "'spekta' 'read' 'README.md'"],
      ["sed -n '2,4p' README.md", "'spekta' 'read' 'README.md[2,4]'"],
      ["rg -e needle src", "'spekta' 'rg' '-e' 'needle' 'src'"],
      ["git status --short", "'spekta' 'git' 'status' '--short'"],
    ])("preserves supported Bash route %s", (input, expected) => {
      expect(rewritten(input)).toBe(expected);
    });

    it.each(["ls -l", "rtk rg needle", "ls src | cat"])(
      "preserves excluded Bash command %s",
      (input) => expect(rewritten(input)).toBeUndefined(),
    );
  },
);

describe.skipIf(process.platform !== "win32")(
  "Codex inspection hook PowerShell routes",
  () => {
    it.each([
      [
        "Get-ChildItem -LiteralPath src -Name",
        "& 'spekta.cmd' 'ls' 'src'",
      ],
      [
        "Get-ChildItem -LiteralPath 'src/folder with spaces' -Name",
        "& 'spekta.cmd' 'ls' 'src/folder with spaces'",
      ],
      [
        "Get-ChildItem -LiteralPath '.\\src\\folder with spaces' -Recurse",
        "& 'spekta.cmd' 'find' '.\\src\\folder with spaces'",
      ],
      [
        'Get-ChildItem -LiteralPath "src/folder with spaces" -Recurse -File',
        "& 'spekta.cmd' 'find' 'src/folder with spaces' '-type' 'f'",
      ],
      [
        "Get-ChildItem -LiteralPath src -Recurse -Directory",
        "& 'spekta.cmd' 'find' 'src' '-type' 'd'",
      ],
      [
        "Get-ChildItem -LiteralPath src -File -Recurse",
        "& 'spekta.cmd' 'find' 'src' '-type' 'f'",
      ],
      [
        "Get-Content -LiteralPath 'src/notes with spaces.txt'",
        "& 'spekta.cmd' 'read' 'src/notes with spaces.txt'",
      ],
      [
        "Get-Content -LiteralPath 'src/owner''s notes.txt' -TotalCount 12",
        "& 'spekta.cmd' 'read' 'src/owner''s notes.txt[1,12]'",
      ],
      [
        "Get-Content -LiteralPath '.\\src\\notes.txt' -TotalCount 0003",
        "& 'spekta.cmd' 'read' '.\\src\\notes.txt[1,0003]'",
      ],
      [
        "Get-Content -LiteralPath src -TotalCount 9007199254740992",
        "& 'spekta.cmd' 'read' 'src[1,9007199254740991]'",
      ],
      [
        "Get-Content -LiteralPath src -TotalCount 9223372036854775807",
        "& 'spekta.cmd' 'read' 'src[1,9007199254740991]'",
      ],
      [
        "Get-Content -LiteralPath 'src/$literal`name.txt'",
        "& 'spekta.cmd' 'read' 'src/$literal`name.txt'",
      ],
      [
        "rg.exe -e 'needle' 'src/file with spaces.ts'",
        "& 'spekta.cmd' 'rg' '-e' 'needle' 'src/file with spaces.ts'",
      ],
      [
        "rg.exe -e first -e 'second pattern' 'src/path with spaces'",
        "& 'spekta.cmd' 'rg' '-e' 'first' '-e' 'second pattern' 'src/path with spaces'",
      ],
      ["git.exe status --short", "& 'spekta.cmd' 'git' 'status' '--short'"],
      [
        "git.exe diff -- 'space name'",
        "& 'spekta.cmd' 'git' 'diff' '--' 'space name'",
      ],
    ])("rewrites literal supported command %s", (input, expected) => {
      expect(rewritten(input)).toBe(expected);
    });

    it("returns the hook response while preserving execution settings", () => {
      const command = "Get-Content -LiteralPath src/notes.txt";
      const toolInput = {
        command,
        timeout: 17,
        run_in_background: false,
      };
      expect(
        rewriteEvent({ ...event(command), tool_input: toolInput }),
      ).toBe(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            updatedInput: {
              ...toolInput,
              command: "& 'spekta.cmd' 'read' 'src/notes.txt'",
            },
          },
        }),
      );
    });

    it.each([
      "ls src",
      "dir src",
      "cat README.md",
      "type README.md",
      "rtk rg needle",
      "find.exe src",
      "Get-ChildItem -Name",
      "Get-ChildItem -LiteralPath src -Name -Force",
      "Get-ChildItem -LiteralPath src -Recurse -Depth 2",
      "Get-Content -LiteralPath src -Tail 2",
      "Get-Content -TotalCount 2 src",
      "Get-Content -LiteralPath src -TotalCount 0",
      "Get-Content -LiteralPath src -TotalCount -1",
      "Get-Content -LiteralPath src -TotalCount 1.5",
      "Get-Content -LiteralPath src -TotalCount 9223372036854775808",
      "Get-Content -LiteralPath $env:HOME",
      'Get-Content -LiteralPath "src/$env:HOME"',
      "Get-Content -LiteralPath 'src/file[1,2]'",
      "Get-Content -LiteralPath ..\\outside.txt",
      "Get-Content -LiteralPath src/file.txt | Out-String",
      "Get-Content -LiteralPath src/file.txt > output.txt",
      "Get-Content -LiteralPath (Join-Path src file.txt)",
      "Get-Content @parameters",
      "rg.exe -e needle ..\\outside",
      "rg.exe --json needle",
      "git.exe log --oneline -n 1",
      "git.exe status --ignored",
    ])("leaves unsupported PowerShell command unchanged: %s", (input) => {
      expect(rewritten(input)).toBeUndefined();
    });
  },
);
