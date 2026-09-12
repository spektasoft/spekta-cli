import path from "path";
import treeSitterPack from "@xberg-io/tree-sitter-language-pack";

type TreeSitterPackModule =
  typeof import("@xberg-io/tree-sitter-language-pack");
const pack = treeSitterPack as unknown as TreeSitterPackModule & {
  default?: TreeSitterPackModule;
};
const getParser: TreeSitterPackModule["getParser"] =
  typeof pack.getParser === "function"
    ? pack.getParser
    : pack.default!.getParser;
const detectLanguage: TreeSitterPackModule["detectLanguage"] =
  typeof pack.detectLanguage === "function"
    ? pack.detectLanguage
    : pack.default!.detectLanguage;
const hasLanguage: TreeSitterPackModule["hasLanguage"] =
  typeof pack.hasLanguage === "function"
    ? pack.hasLanguage
    : pack.default!.hasLanguage;

// Languages verified to have node-kind coverage in ast.ts (FUNCTION_NODE_KINDS /
// CONTAINER_NODE_KINDS). The pack supports 371 languages total; anything outside
// this tier can still be parsed for token counting but is not yet safe to
// structurally compact. Markup/data languages (json, css, html, yaml) are
// deliberately excluded: their grammars have no function or container node
// kinds, so they can never produce a CollapseRegion. See
// engine.compactable-tier.test.ts, which fails automatically if a future
// addition to this tier lacks real node-kind coverage.
export const KNOWN_COMPACTABLE_LANGUAGES = new Set([
  "typescript",
  "tsx",
  "javascript",
  "php",
  "kotlin",
]);

const parserCache = new Map<string, ReturnType<typeof getParser>>();

export function getOrCreateParser(
  language: string,
): ReturnType<typeof getParser> {
  const cached = parserCache.get(language);
  if (cached) {
    return cached;
  }
  const parser = getParser(language);
  parserCache.set(language, parser);
  return parser;
}

export function resolveLanguage(filePath: string): string {
  const baseName = path.basename(filePath);
  if (baseName.endsWith(".blade.php")) {
    return "php";
  }
  const detected = detectLanguage(filePath);
  if (!detected || !hasLanguage(detected)) {
    throw new Error(
      `Tree-sitter compaction failed: unsupported file extension for "${filePath}"`,
    );
  }
  return detected;
}
