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
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Matches any line ending in { or being just { (Option B)
      if (trimmed.endsWith("{")) {
        result.push(line);
        const blockStartIdx = i;
        let braceCount = 0;
        let foundEnd = false;

        for (let j = i; j < lines.length; j++) {
          const openMatches = (lines[j].match(/{/g) || []).length;
          const closeMatches = (lines[j].match(/}/g) || []).length;
          braceCount += openMatches - closeMatches;

          if (braceCount === 0 && j > i) {
            const collapsedCount = j - blockStartIdx - 1;
            // Aggressive threshold: > 1 line
            if (collapsedCount > 1) {
              const absStart = startLine + blockStartIdx + 1;
              const absEnd = startLine + j - 1;
              const indent = line.match(/^\s*/)?.[0] || "";
              result.push(
                `${indent}  // ... [lines ${absStart}-${absEnd} collapsed]`,
              );
              result.push(lines[j]);
            } else {
              for (let k = i + 1; k <= j; k++) result.push(lines[k]);
            }
            i = j + 1;
            foundEnd = true;
            break;
          }
        }
        if (!foundEnd) i++;
      } else {
        result.push(line);
        i++;
      }
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
