import path from "path";

export interface CompactionResult {
  content: string;
  isCompacted: boolean;
}

export interface CompactionStrategy {
  canHandle(extension: string): boolean;
  compact(lines: string[]): string;
}

class BraceCompactor implements CompactionStrategy {
  private blockKeywords =
    /^(export\s+|async\s+)?(function|class|interface|enum|const|let|var|abstract\s+class|public\s+|private\s+|protected\s+|static\s+|type)\s+/;

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

  compact(lines: string[]): string {
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Detect start of a potential block
      if (this.blockKeywords.test(trimmed) && trimmed.includes("{")) {
        result.push(line);
        const startLine = i;
        let braceCount = 0;
        let foundEnd = false;

        // Trace braces to find the end of the block
        for (let j = i; j < lines.length; j++) {
          const openMatches = (lines[j].match(/{/g) || []).length;
          const closeMatches = (lines[j].match(/}/g) || []).length;
          braceCount += openMatches - closeMatches;

          if (braceCount === 0 && j > i) {
            const collapsedCount = j - startLine - 1;
            if (collapsedCount > 3) {
              result.push(
                `${line.match(/^\s*/)?.[0] || ""}  // ... [${collapsedCount} lines collapsed]`,
              );
              result.push(lines[j]);
            } else {
              // Too small to collapse, add original lines
              for (let k = i + 1; k <= j; k++) result.push(lines[k]);
            }
            i = j + 1; // Move past the end of the block
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

  compact(lines: string[]): string {
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (
        trimmed.endsWith(":") &&
        (trimmed.startsWith("def ") || trimmed.startsWith("class "))
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
        if (collapsedCount > 2) {
          const indentStr = " ".repeat(baseIndent + 4);
          result.push(`${indentStr}# ... [${collapsedCount} lines collapsed]`);
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

  compact(lines: string[]): string {
    const result: string[] = [];
    const directivePattern =
      /^@(if|foreach|for|while|section|can|component|slot|push)/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (
        directivePattern.test(trimmed) ||
        (trimmed.startsWith("<") &&
          !trimmed.startsWith("</") &&
          !trimmed.endsWith("/>"))
      ) {
        result.push(line);
        // Basic heuristic: if the next line is deeply nested or just text, peek ahead
        let j = i + 1;
        if (
          j < lines.length &&
          !lines[j].trim().startsWith("<") &&
          !lines[j].trim().startsWith("@")
        ) {
          // Find next structural line
          while (
            j < lines.length &&
            !lines[j].trim().startsWith("<") &&
            !lines[j].trim().startsWith("@") &&
            !lines[j].trim().startsWith("</")
          ) {
            j++;
          }
          if (j - i > 3) {
            result.push(
              `${line.match(/^\s*/)?.[0] || ""}  {{-- ... [${j - i - 1} lines collapsed] --}}`,
            );
            i = j - 1;
          }
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
): CompactionResult {
  const ext = path.extname(filePath);
  const strategy = COMPACTORS.find((s) => s.canHandle(ext));
  if (!strategy) return { content, isCompacted: false };

  const lines = content.split("\n");
  const compacted = strategy.compact(lines);
  return {
    content: compacted,
    isCompacted: compacted.length < content.length,
  };
}
