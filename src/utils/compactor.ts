import path from "path";

// Helper function to detect if a line contains quotes that might indicate string literals
const hasQuotes = (line: string): boolean =>
  line.includes('"') ||
  line.includes("'") ||
  line.includes("`") ||
  line.includes("/");

// Pattern matchers for semantic analysis
const IMPORT_PATTERN = /^\s*(import\s+.*from|import\s*{|import\s+type)/;
const TEST_BLOCK_PATTERN =
  /^\s*(it|test|beforeEach|afterEach|beforeAll|afterAll)\s*\(/;
const DESCRIBE_PATTERN = /^\s*describe\s*\(/;
const FUNCTION_DECLARATION = /^\s*(export\s+)?(async\s+)?function\s+\w+/;
const METHOD_DECLARATION = /^\s*(\w+)\s*\([^)]*\)\s*[:{]/;
const ARROW_FUNCTION = /^\s*(const|let|var)\s+\w+\s*=\s*(\([^)]*\))?\s*=>/;
const CLASS_DECLARATION = /^\s*(export\s+)?(abstract\s+)?class\s+\w+/;

/**
 * Detect if a line is part of the import block at top of file
 */
function isInImportBlock(lineIdx: number, lines: string[]): boolean {
  // Scan backwards to see if we're in import zone
  for (let i = lineIdx; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("/*"))
      continue;
    if (IMPORT_PATTERN.test(trimmed)) return true;
    // If we hit non-import code, we're past import block
    if (trimmed && !IMPORT_PATTERN.test(trimmed) && !trimmed.startsWith("*"))
      return false;
  }
  return false;
}

/**
 * Check if line starts a collapsible block
 */
function getBlockType(
  line: string,
  lineIdx: number,
  lines: string[],
):
  | "test"
  | "function"
  | "method"
  | "arrow"
  | "class"
  | "object"
  | "brace"
  | null {
  const trimmed = line.trim();

  if (TEST_BLOCK_PATTERN.test(trimmed)) return "test";
  if (CLASS_DECLARATION.test(trimmed)) return "class";
  if (FUNCTION_DECLARATION.test(trimmed)) return "function";
  if (ARROW_FUNCTION.test(trimmed)) return "arrow";
  if (METHOD_DECLARATION.test(trimmed)) return "method";

  // Detect object literals in expect statements
  if (
    trimmed.includes(".toEqual({") ||
    trimmed.includes(".toMatchObject({") ||
    (trimmed.endsWith("{") &&
      lineIdx > 0 &&
      lines[lineIdx - 1].includes("expect("))
  ) {
    return "object";
  }

  if (trimmed.endsWith("{") && !hasQuotes(trimmed)) return "brace";

  return null;
}

interface BraceMatch {
  openLine: number;
  closeLine: number;
  depth: number;
  type: "test" | "function" | "method" | "arrow" | "class" | "object" | "brace";
}

/**
 * Find all matching brace pairs in the code
 * Returns map of opening line -> closing line with metadata
 */
function findBraceMatches(lines: string[]): Map<number, BraceMatch> {
  const matches = new Map<number, BraceMatch>();
  const stack: {
    lineIdx: number;
    depth: number;
    type: ReturnType<typeof getBlockType>;
  }[] = [];
  let currentDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip import lines
    if (isInImportBlock(i, lines)) continue;

    // Count braces
    const openCount = (line.match(/{/g) || []).length;
    const closeCount = (line.match(/}/g) || []).length;

    // Detect block opening
    const blockType = getBlockType(line, i, lines);
    if (blockType && trimmed.endsWith("{")) {
      stack.push({ lineIdx: i, depth: currentDepth, type: blockType });
    }

    currentDepth += openCount - closeCount;

    // Match closing braces
    while (stack.length > 0 && currentDepth <= stack[stack.length - 1].depth) {
      const top = stack.pop()!;
      if (i > top.lineIdx && top.type) {
        matches.set(top.lineIdx, {
          openLine: top.lineIdx,
          closeLine: i,
          depth: top.depth,
          type: top.type,
        });
      }
    }
  }

  return matches;
}

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

class SemanticCompactor implements CompactionStrategy {
  canHandle(ext: string): boolean {
    // Handle all code file types
    return [
      ".ts",
      ".js",
      ".tsx",
      ".jsx",
      ".py",
      ".php",
      ".html",
      ".blade.php",
      ".xml",
      ".css",
      ".scss",
      ".json",
      ".yml",
      ".yaml",
    ].includes(ext);
  }

  compact(
    lines: string[],
    startLine: number,
  ): { content: string; didCompact: boolean } {
    // Pass 1: Find all brace matches
    const braceMatches = findBraceMatches(lines);

    // Pass 2: Identify collapsible regions
    const collapseRegions = this.identifyCollapseRegions(lines, braceMatches);

    // Pass 3: Build output with collapsed sections
    return this.buildCompactedOutput(lines, collapseRegions, startLine);
  }

  private identifyCollapseRegions(
    lines: string[],
    braceMatches: Map<number, BraceMatch>,
  ): BraceMatch[] {
    const regions: BraceMatch[] = [];
    const usedLines = new Set<number>();

    // Sort by line number for sequential processing
    const sortedMatches = Array.from(braceMatches.values()).sort(
      (a, b) => a.openLine - b.openLine,
    );

    for (const match of sortedMatches) {
      // Skip if already inside a collapsed region
      if (usedLines.has(match.openLine)) continue;

      const bodyLines = match.closeLine - match.openLine - 1;

      // Aggressive collapsing rules:
      // - Test blocks: always collapse if >0 lines
      // - Functions/methods: collapse if >0 lines
      // - Classes: never collapse (only their methods)
      // - Generic braces: collapse if >1 lines

      if (match.type === "class") continue; // Never collapse class declarations

      const shouldCollapse =
        (match.type === "test" && bodyLines > 0) ||
        (match.type === "function" && bodyLines > 0) ||
        (match.type === "method" && bodyLines > 0) ||
        (match.type === "arrow" && bodyLines > 0) ||
        (match.type === "object" && bodyLines > 0) || // Add object literal collapsing
        (match.type === "brace" && bodyLines > 1);

      if (shouldCollapse) {
        regions.push(match);
        // Mark all lines in this region as used
        for (let i = match.openLine; i <= match.closeLine; i++) {
          usedLines.add(i);
        }
      }
    }

    return regions;
  }

  private buildCompactedOutput(
    lines: string[],
    regions: BraceMatch[],
    startLine: number,
  ): { content: string; didCompact: boolean } {
    if (regions.length === 0) {
      return { content: lines.join("\n"), didCompact: false };
    }

    const result: string[] = [];
    const collapsedLines = new Set<number>();

    // Mark lines that will be collapsed
    for (const region of regions) {
      for (let i = region.openLine + 1; i < region.closeLine; i++) {
        collapsedLines.add(i);
      }
    }

    // Build output
    for (let i = 0; i < lines.length; i++) {
      if (collapsedLines.has(i)) {
        // Check if this is the first collapsed line in a region
        const region = regions.find((r) => i === r.openLine + 1);
        if (region) {
          const absStart = startLine + region.openLine + 1;
          const absEnd = startLine + region.closeLine - 1;
          const indent = lines[region.openLine].match(/^\s*/)?.[0] || "";
          result.push(
            `${indent}  // ... [lines ${absStart}-${absEnd} collapsed]`,
          );
        }
        // Skip all other collapsed lines
        continue;
      }
      result.push(lines[i]);
    }

    return { content: result.join("\n"), didCompact: true };
  }
}

export const COMPACTORS: CompactionStrategy[] = [new SemanticCompactor()];

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
