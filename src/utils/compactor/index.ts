import { extractCollapseRegions } from "./engine";
import { renderCompactedContent } from "./renderer";
import { resolveLanguage, KNOWN_COMPACTABLE_LANGUAGES } from "./parser";
import { CompactionResult, CompactionStrategy } from "./types";

export class TreeSitterCompactor implements CompactionStrategy {
  canHandle(extension: string): boolean {
    try {
      resolveLanguage(`file${extension.toLowerCase()}`);
      return true;
    } catch {
      return false;
    }
  }

  compact(
    lines: string[],
    startLine: number,
  ): { content: string; didCompact: boolean } {
    return renderCompactedContent(lines, [], startLine);
  }
}

export function compactFile(
  filePath: string,
  content: string,
  startLine: number = 1,
): CompactionResult {
  let language: string;
  try {
    language = resolveLanguage(filePath);
  } catch {
    return { content, isCompacted: false };
  }

  if (!KNOWN_COMPACTABLE_LANGUAGES.has(language)) {
    return {
      content,
      isCompacted: false,
      warning: `Compaction skipped: "${language}" support is not yet verified for structural compaction.`,
    };
  }

  const regions = extractCollapseRegions(filePath, content);
  const lines = content.split("\n");
  const { content: compacted, didCompact } = renderCompactedContent(
    lines,
    regions,
    startLine,
  );

  return {
    content: compacted,
    isCompacted: didCompact,
  };
}

export * from "./types";
export { extractCollapseRegions, resolveLanguage } from "./engine";
export { renderCompactedContent } from "./renderer";
