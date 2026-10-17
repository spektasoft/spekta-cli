import { describe, expect, it } from "vitest";
import { rewritten } from "./codex-hook.test-helpers.js";

describe("Codex inspection hook supported commands", () => {
  it.each([
    ["ls", "'spekta' 'ls'"],
    ["ls missing-dir", "'spekta' 'ls' 'missing-dir'"],
    ["ls a b", "'spekta' 'ls' 'a' 'b'"],
    ["ls src", "'spekta' 'ls' 'src'"],
    ["find", "'spekta' 'find'"],
    [
      "find src -type f -name '*.ts'",
      "'spekta' 'find' 'src' '-type' 'f' '-name' '*.ts'",
    ],
    [
      "find src test src -name '*.ts' -type f -print",
      "'spekta' 'find' 'src' 'test' 'src' '-name' '*.ts' '-type' 'f' '-print'",
    ],
    [
      "find src -name '--allowance'",
      "'spekta' 'find' 'src' '-name' '--allowance'",
    ],
    ["find src -name '-exec'", "'spekta' 'find' 'src' '-name' '-exec'"],
    [
      "find src -name '$(echo literal)'",
      "'spekta' 'find' 'src' '-name' '$(echo literal)'",
    ],
    ["find -name 'literal ; *.ts'", "'spekta' 'find' '-name' 'literal ; *.ts'"],
    [
      "find ../outside -name '*.ts'",
      "'spekta' 'find' '../outside' '-name' '*.ts'",
    ],
  ])("rewrites literal %s", (input, expected) =>
    expect(rewritten(input)).toBe(expected),
  );
});
