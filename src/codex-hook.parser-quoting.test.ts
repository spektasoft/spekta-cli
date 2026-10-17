import { describe, expect, it } from "vitest";
import { rewritten } from "./codex-hook.test-helpers.js";

describe("Codex inspection hook shell quoting", () => {
  it.each([
    ["ls 'a b'", "'spekta' 'ls' 'a b'"],
    ["ls '日本語'", "'spekta' 'ls' '日本語'"],
    ["ls 'a'\\''b'", "'spekta' 'ls' 'a'\\''b'"],
    ["ls 'a;|*?$'", "'spekta' 'ls' 'a;|*?$'"],
    ["ls a\\ b", "'spekta' 'ls' 'a b'"],
    ["l's'\"\"", "'spekta' 'ls'"],
    ["ls\tfoo", "'spekta' 'ls' 'foo'"],
    ["ls 'a b'", "'spekta' 'ls' 'a b'"],
    ['ls "a\\qb"', "'spekta' 'ls' 'a\\qb'"],
    ['ls "a\\"b"', "'spekta' 'ls' 'a\"b'"],
    ['ls "a\\$b\\`c\\\\d"', "'spekta' 'ls' 'a$b`c\\d'"],
    ['ls "a;|*?[]{}()<>!#~"', "'spekta' 'ls' 'a;|*?[]{}()<>!#~'"],
  ])("rewrites literal %s", (input, expected) =>
    expect(rewritten(input)).toBe(expected),
  );
});
