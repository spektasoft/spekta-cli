import path from "path";
import { extractCollapseRegions } from "./engine";
import { renderCompactedContent } from "./renderer";
import { EXTENSION_LANGUAGE_MAP } from "./parser";
import { CompactionResult, CompactionStrategy } from "./types";

export class TreeSitterCompactor implements CompactionStrategy {
  canHandle(extension: string): boolean {
    return Object.prototype.hasOwnProperty.call(
      EXTENSION_LANGUAGE_MAP,
      extension.toLowerCase(),
    );
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
  const extension = path.extname(filePath);
  if (!new TreeSitterCompactor().canHandle(extension)) {
    return { content, isCompacted: false };
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
