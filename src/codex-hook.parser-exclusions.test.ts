import { describe, expect, it } from "vitest";
import { rewritten } from "./codex-hook.test-helpers.js";

describe("Codex inspection hook excluded syntax", () => {
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
    "rg",
    "rg -n needle",
    "rg -F needle",
    "rg -l needle",
    "rg --json needle",
    "rg needle -",
    "rg --pre foo needle",
    "rg --glob",
    "rg --glob '*.ts'",
    "rg -e",
    "rg --regexp",
    "rtk ls",
    "rtk rg --no-config needle",
    "ls --",
    "ls -l",
    "ls --allowance 100 a",
    'ls ""',
  ])("does not rewrite excluded syntax: %s", (input) =>
    expect(rewritten(input)).toBeUndefined(),
  );
});
