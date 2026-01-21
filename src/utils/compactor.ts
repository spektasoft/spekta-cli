import path from "path";

export interface CompactionResult {
  content: string;
  isCompacted: boolean;
}

export interface CompactionStrategy {
  canHandle(extension: string): boolean;
  compact(lines: string[], startLine: number): string;
}

class BraceCompactor implements CompactionStrategy {
  canHandle(ext: string): boolean {
    return [
      ".ts",
      ".js",
      ".tsx",
      ".jsx",
      ".php",
      ".json",
      ".css",
      ".scss",
    ].includes(ext);
  }

  compact(lines: string[], startLine: number): string {
    const matchingEnd = new Array(lines.length).fill(-1);
    const stack: { lineIdx: number; depthAtStart: number }[] = [];
    let currentDepth = 0;

    // Pass 1: Find matching closing braces for lines ending in "{"
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const openMatches = (line.match(/{/g) || []).length;
      const closeMatches = (line.match(/}/g) || []).length;
      const endsWithOpen = line.trim().endsWith("{");

      if (endsWithOpen) {
        stack.push({ lineIdx: i, depthAtStart: currentDepth });
      }

      currentDepth += openMatches - closeMatches;

      while (
        stack.length > 0 &&
        currentDepth <= stack[stack.length - 1].depthAtStart
      ) {
        const top = stack.pop()!;
        if (i > top.lineIdx) {
          matchingEnd[top.lineIdx] = i;
        }
      }
    }

    // Pass 2: Build the result by collapsing the first long enough blocks encountered
    const result: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const endIdx = matchingEnd[i];
      if (endIdx !== -1) {
        const collapsedCount = endIdx - i - 1;
        if (collapsedCount > 1) {
          const line = lines[i];
          result.push(line);
          const absStart = startLine + i + 1;
          const absEnd = startLine + endIdx - 1;
          const indent = line.match(/^\s*/)?.[0] || "";
          result.push(
            `${indent}  // ... [lines ${absStart}-${absEnd} collapsed]`,
          );
          result.push(lines[endIdx]);
          i = endIdx;
          continue;
        }
      }
      result.push(lines[i]);
    }

    return result.join("\n");
  }
}

class IndentationCompactor implements CompactionStrategy {
  canHandle(ext: string): boolean {
    return [".py", ".yml", ".yaml"].includes(ext);
  }

  compact(lines: string[], startLine: number): string {
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (
        trimmed.endsWith(":") &&
        (trimmed.startsWith("def ") ||
          trimmed.startsWith("class ") ||
          !trimmed.startsWith("#"))
      ) {
        result.push(line);
        const baseIndent = line.match(/^\s*/)?.[0].length || 0;
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j];
          if (nextLine.trim() === "") {
            j++;
            continue;
          }
          const nextIndent = nextLine.match(/^\s*/)?.[0].length || 0;
          if (nextIndent <= baseIndent) break;
          j++;
        }

        const collapsedCount = j - i - 1;
        if (collapsedCount > 1) {
          const absStart = startLine + i + 1;
          const absEnd = startLine + j - 1;
          const indentStr = " ".repeat(baseIndent + 2);
          result.push(
            `${indentStr}# ... [lines ${absStart}-${absEnd} collapsed]`,
          );
          i = j - 1;
        }
      } else {
        result.push(line);
      }
      i++;
    }
    return result.join("\n");
  }
}

class TagCompactor implements CompactionStrategy {
  canHandle(ext: string): boolean {
    return [".html", ".blade.php", ".xml"].includes(ext);
  }

  compact(lines: string[], startLine: number): string {
    const result: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      const isDirective = trimmed.startsWith("@");
      const isTag =
        trimmed.startsWith("<") &&
        !trimmed.startsWith("</") &&
        !trimmed.endsWith("/>");

      if (isDirective || isTag) {
        result.push(line);
        let j = i + 1;
        // Find the next line with same or less indentation or a closing tag/directive
        while (j < lines.length) {
          const nextTrimmed = lines[j].trim();
          if (
            isDirective &&
            (nextTrimmed.startsWith("@end") || nextTrimmed.startsWith("@else"))
          )
            break;
          if (isTag && nextTrimmed.startsWith("</")) break;
          j++;
        }

        const collapsedCount = j - i - 1;
        if (collapsedCount > 1) {
          const absStart = startLine + i + 1;
          const absEnd = startLine + j - 1;
          const indent = line.match(/^\s*/)?.[0] || "";
          const comment = `{{-- ... [lines ${absStart}-${absEnd} collapsed] --}}`;
          result.push(`${indent}  ${comment}`);
          i = j - 1;
        }
      } else {
        result.push(line);
      }
    }
    return result.join("\n");
  }
}

export const COMPACTORS: CompactionStrategy[] = [
  new BraceCompactor(),
  new IndentationCompactor(),
  new TagCompactor(),
];

export function compactFile(
  filePath: string,
  content: string,
  startLine: number = 1,
): CompactionResult {
  const ext = path.extname(filePath);
  const strategy = COMPACTORS.find((s) => s.canHandle(ext));
  if (!strategy) return { content, isCompacted: false };

  const lines = content.split("\n");
  const compacted = strategy.compact(lines, startLine);
  return {
    content: compacted,
    isCompacted: compacted.length < content.length,
  };
}
