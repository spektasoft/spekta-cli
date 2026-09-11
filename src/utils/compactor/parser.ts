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

export const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".php": "php",
  ".blade.php": "php",
  ".json": "json",
  ".css": "css",
  ".scss": "css",
  ".html": "html",
  ".yaml": "yaml",
  ".yml": "yaml",
};

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
  const ext = path.extname(filePath).toLowerCase();
  const lang = EXTENSION_LANGUAGE_MAP[ext];
  if (!lang) {
    throw new Error(
      `Tree-sitter compaction failed: unsupported file extension for "${filePath}"`,
    );
  }
  return lang;
}
