import { describe, expect, it } from "vitest";
import { rewritten } from "./codex-hook.test-helpers.js";

describe("Codex inspection hook Git, read, and search routes", () => {
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
});
