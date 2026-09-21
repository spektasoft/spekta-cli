export interface GeminiPart {
  text?: string;
  thought?: boolean;
}

/**
 * Removes Gemma 4 thinking channel blocks from a response string.
 *
 * Gemma 4 uses <|channel>thought\n…<channel|> delimiters to wrap
 * internal reasoning. The Gemini SDK may surface these as raw text in
 * certain response shapes. This function strips the entire block,
 * including the delimiters, and trims the result.
 *
 * The regex is non-greedy and uses the `s` (dotAll) flag so that
 * multi-line thought blocks are matched correctly.
 */
export function stripGemmaThinkingTokens(text: string): string {
  return text.replace(/<\|channel>thought\n[\s\S]*?<channel\|>/g, "");
}
