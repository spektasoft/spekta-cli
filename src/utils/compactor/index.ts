import { extractCollapseRegions } from "./engine";
import { renderCompactedContent } from "./renderer";
import { CompactionResult, CompactionStrategy } from "./types";

export class TreeSitterCompactor implements CompactionStrategy {
  canHandle(extension: string): boolean {
    return [
      ".ts",
      ".mts",
      ".cts",
      ".tsx",
      ".js",
      ".mjs",
      ".cjs",
      ".jsx",
      ".py",
      ".php",
      ".blade.php",
      ".html",
      ".css",
      ".scss",
      ".json",
      ".yaml",
      ".yml",
    ].includes(extension.toLowerCase());
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
