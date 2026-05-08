import { describe, it, expect } from "vitest";
import { stripGemmaThinkingTokens } from "./gemini-adapter";

describe("stripGemmaThinkingTokens", () => {
  it("strips a single thinking block", () => {
    const input =
      "<|channel>thought\nLet me think about this.\n<channel|>The answer is 42.";
    expect(stripGemmaThinkingTokens(input)).toBe("The answer is 42.");
  });

  it("strips a multi-line thinking block", () => {
    const input =
      "<|channel>thought\nLine one.\nLine two.\nLine three.\n<channel|>Final response.";
    expect(stripGemmaThinkingTokens(input)).toBe("Final response.");
  });

  it("returns the original string unchanged when no block is present", () => {
    const input = "feat: add login endpoint";
    expect(stripGemmaThinkingTokens(input)).toBe("feat: add login endpoint");
  });

  it("trims surrounding whitespace after stripping", () => {
    const input =
      "<|channel>thought\nThinking...\n<channel|>\n\nThe commit message.";
    expect(stripGemmaThinkingTokens(input).trim()).toBe("The commit message.");
  });
});
