import { describe, expect, it } from "vitest";
import { getTokenCount } from "./read-utils";

describe("getTokenCount with the installed GPT Tokenizer", () => {
  it.each([
    ["ASCII", "The quick brown fox jumps over the lazy dog.", 10],
    ["Unicode", "こんにちは世界 🌍 café — Привет мир", 9],
    ["code", "function add(a: number, b: number) { return a + b; }", 17],
    ["empty text", "", 0],
  ])("preserves the established %s count", (_label, text, expected) => {
    expect(getTokenCount(text)).toBe(expected);
  });

  it.each([999, 1000, 1001, 1999, 2000, 2001, 4999, 5000, 5001])(
    "counts repeated text accurately around allowance and warning boundaries (%i)",
    (expected) => {
      expect(getTokenCount(" token".repeat(expected))).toBe(expected);
    },
  );
});
