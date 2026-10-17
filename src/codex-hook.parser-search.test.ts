import { describe, expect, it } from "vitest";
import { rewritten } from "./codex-hook.test-helpers.js";

describe("Codex inspection hook search routes", () => {
  it.each([
    ["rg needle", "'spekta' 'rg' 'needle'"],
    ["rg 'a.b' src", "'spekta' 'rg' 'a.b' 'src'"],
    ["rg -i needle", "'spekta' 'rg' '-i' 'needle'"],
    [
      "rg --glob '*.ts' needle src",
      "'spekta' 'rg' '--glob' '*.ts' 'needle' 'src'",
    ],
    [
      "rg -e first -e 'second pattern' src docs",
      "'spekta' 'rg' '-e' 'first' '-e' 'second pattern' 'src' 'docs'",
    ],
    ["rg needle src docs", "'spekta' 'rg' 'needle' 'src' 'docs'"],
    [
      "rg -g '*.ts' -g '!*.test.ts' 'foo|bar' src",
      "'spekta' 'rg' '-g' '*.ts' '-g' '!*.test.ts' 'foo|bar' 'src'",
    ],
    ["rg -e '-needle' -- path", "'spekta' 'rg' '-e' '-needle' '--' 'path'"],
    ["rg -- -needle", "'spekta' 'rg' '--' '-needle'"],
    ["rg -- -", "'spekta' 'rg' '--' '-'"],
    [
      "rg -e 'foo bar' --regexp='a|b' src docs",
      "'spekta' 'rg' '-e' 'foo bar' '--regexp=a|b' 'src' 'docs'",
    ],
    [
      "rg -s -S -i -g '*.ts,*.tsx' -g '!*.test.ts' 'foo' src docs",
      "'spekta' 'rg' '-s' '-S' '-i' '-g' '*.ts,*.tsx' '-g' '!*.test.ts' 'foo' 'src' 'docs'",
    ],
  ])("routes representable search %s", (input, expected) =>
    expect(rewritten(input)).toBe(expected),
  );
});
