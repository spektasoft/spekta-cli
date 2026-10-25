import path from "path";
import { createRequire } from "node:module";

type TreeSitterPackModule =
  typeof import("@xberg-io/tree-sitter-language-pack");
const require = createRequire(import.meta.url);
let pack: TreeSitterPackModule | undefined;
type Parser = ReturnType<TreeSitterPackModule["getParser"]>;

function getTreeSitterPack(): TreeSitterPackModule {
  if (process.platform === "win32") {
    throw new Error("Structural overview is unavailable on Windows.");
  }
  if (!pack) {
    const loaded = require(
      "@xberg-io/tree-sitter-language-pack",
    ) as Partial<TreeSitterPackModule> & {
      default?: TreeSitterPackModule;
    };
    pack =
      typeof loaded.getParser === "function"
        ? (loaded as TreeSitterPackModule)
        : loaded.default;
    if (!pack) {
      throw new Error("Tree-sitter language pack has no parser exports.");
    }
  }
  return pack;
}

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
  "python",
]);

const parserCache = new Map<string, Parser>();

export function getOrCreateParser(language: string): Parser {
  const cached = parserCache.get(language);
  if (cached) {
    return cached;
  }
  const parser = getTreeSitterPack().getParser(language);
  parserCache.set(language, parser);
  return parser;
}

export function resolveLanguage(filePath: string): string {
  const baseName = path.basename(filePath);
  if (baseName.endsWith(".blade.php")) {
    return "php";
  }
  const parserPack = getTreeSitterPack();
  const detected = parserPack.detectLanguage(filePath);
  if (!detected || !parserPack.hasLanguage(detected)) {
    throw new Error(
      `Tree-sitter compaction failed: unsupported file extension for "${filePath}"`,
    );
  }
  return detected;
}
