import path from "path";

// Helper function to detect if a line contains quotes that might indicate string literals
const hasQuotes = (line: string): boolean =>
  line.includes('"') ||
  line.includes("'") ||
  line.includes("`") ||
  line.includes("/");

export interface CompactionResult {
  content: string;
  isCompacted: boolean;
}

export interface CompactionStrategy {
  canHandle(extension: string): boolean;
  compact(
    lines: string[],
    startLine: number,
  ): { content: string; didCompact: boolean };
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

  compact(
    lines: string[],
    startLine: number,
  ): { content: string; didCompact: boolean } {
    const matchingEnd = new Array(lines.length).fill(-1);
    const stack: { lineIdx: number; depthAtStart: number }[] = [];
    let currentDepth = 0;

    // Pass 1: Find matching closing braces for lines ending in "{"
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const openMatches = (line.match(/{/g) || []).length;
      const closeMatches = (line.match(/}/g) || []).length;
      const trimmed = line.trim();
      const endsWithOpen = trimmed.endsWith("{");

      if (endsWithOpen && !hasQuotes(trimmed)) {
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
    let didCompact = false;
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
          didCompact = true;
          continue;
        }
      }
      result.push(lines[i]);
    }

    return { content: result.join("\n"), didCompact };
  }
}

class IndentationCompactor implements CompactionStrategy {
  canHandle(ext: string): boolean {
    return [".py", ".yml", ".yaml"].includes(ext);
  }

  compact(
    lines: string[],
    startLine: number,
  ): { content: string; didCompact: boolean } {
    const result: string[] = [];
    let i = 0;
    let didCompact = false;

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
          didCompact = true;
        }
      } else {
        result.push(line);
      }
      i++;
    }
    return { content: result.join("\n"), didCompact };
  }
}

class TagCompactor implements CompactionStrategy {
  canHandle(ext: string): boolean {
    return [".html", ".blade.php", ".xml"].includes(ext);
  }

  compact(
    lines: string[],
    startLine: number,
  ): { content: string; didCompact: boolean } {
    const result: string[] = [];
    let didCompact = false;
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
          didCompact = true;
        }
      } else {
        result.push(line);
      }
    }
    return { content: result.join("\n"), didCompact };
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
  const { content: compacted, didCompact } = strategy.compact(lines, startLine);
  return {
    content: compacted,
    isCompacted: didCompact,
  };
}
