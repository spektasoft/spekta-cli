import path from "path";

// Helper function to detect if a line contains quotes that might indicate string literals
const hasQuotes = (line: string): boolean =>
  line.includes('"') ||
  line.includes("'") ||
  line.includes("`") ||
  line.includes("/");

// Pattern matchers for semantic analysis
const IMPORT_PATTERN =
  /^\s*(import\s+.*from|import\s*{|import\s+type|use\s+[\w\\]+)/;
const TEST_BLOCK_PATTERN =
  /^\s*(it|test|beforeEach|afterEach|beforeAll|afterAll)\s*\(/;
const FUNCTION_DECLARATION = /^\s*(export\s+)?(async\s+)?function\s+\w+/;
const METHOD_DECLARATION = /^\s*(\w+)\s*\([^)]*\)\s*[:{]/;
const ARROW_FUNCTION = /^\s*(const|let|var)\s+\w+\s*=\s*(\([^)]*\))?\s*=>/;
const CLASS_DECLARATION =
  /^\s*(export\s+)?(abstract\s+|final\s+)?(class|interface|trait|enum)\s+\w+/;

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

  return null;
}

interface BraceMatch {
  openLine: number;
  closeLine: number;
  depth: number;
  type: "test" | "function" | "method" | "arrow" | "class" | "object" | "brace";
}

/**
 * Check if a multi-line statement should be treated as single logical unit
 */
function isSingleLineLogical(
  openLine: number,
  closeLine: number,
  lines: string[],
  type: BraceMatch["type"],
): boolean {
  // If opening and closing are on same line, it's single-line
  if (openLine === closeLine) return true;

  // Types that should ALWAYS collapse if multi-line, regardless of density
  if (
    type === "test" ||
    type === "function" ||
    type === "method" ||
    type === "object"
  ) {
    return false;
  }

  // If it's just "{ ... }" on consecutive lines with no actual content
  if (closeLine - openLine === 1) return true;

  // Check if all content fits visually on ~80 chars when unwrapped
  const content = lines.slice(openLine, closeLine + 1).join(" ");
  return content.length < 80;
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

  // Track if we are still in the initial import block
  let inImportBlock = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Handle import block skipping
    if (inImportBlock) {
      if (
        trimmed === "" ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*")
      ) {
        // Still potentially in import block (comments/empty)
        continue;
      }
      if (IMPORT_PATTERN.test(trimmed)) {
        // Definitely an import
        continue;
      }
      // First non-import/non-comment line found
      inImportBlock = false;
    }

    // Count braces
    const openCount = (line.match(/{/g) || []).length;
    const closeCount = (line.match(/}/g) || []).length;

    const openBraceIdx = line.indexOf("{");
    if (openBraceIdx !== -1) {
      let blockType = getBlockType(line, i, lines);

      // Look-back for Allman style (brace on new line)
      if (!blockType && i > 0) {
        const prevLine = lines[i - 1].trim();
        if (
          prevLine !== "" &&
          !prevLine.startsWith("/") &&
          !prevLine.startsWith("*")
        ) {
          blockType = getBlockType(lines[i - 1], i - 1, lines);
        }
      }

      // Default to generic brace if no semantic type found
      if (!blockType && line.trim().endsWith("{")) {
        blockType = "brace";
      }

      if (blockType) {
        stack.push({ lineIdx: i, depth: currentDepth, type: blockType });
      }
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

      // Check if it's a single-line logical unit
      if (
        isSingleLineLogical(match.openLine, match.closeLine, lines, match.type)
      ) {
        continue;
      }

      // Special Case: Object Literal Visibility
      // If this is a 'test' block, check if it contains a collapsible 'object' literal.
      // If so, we SKIP collapsing the test block so the object assertion remains visible.
      if (match.type === "test") {
        const hasCollapsibleObjectChild = sortedMatches.some(
          (child) =>
            child.openLine > match.openLine &&
            child.closeLine < match.closeLine &&
            child.type === "object" &&
            !isSingleLineLogical(
              child.openLine,
              child.closeLine,
              lines,
              child.type,
            ),
        );
        if (hasCollapsibleObjectChild) {
          continue;
        }
      }

      const bodyLines = match.closeLine - match.openLine - 1;

      // Aggressive collapsing rules:
      // - Test blocks: always collapse if >0 lines
      // - Functions/methods: collapse if >0 lines
      // - Container types (class, interface, trait, enum): never collapse (only their methods)
      // - Generic braces: collapse if >1 lines

      if (match.type === "class") continue; // Never collapse container declarations

      const shouldCollapse =
        (match.type === "test" && bodyLines > 0) ||
        (match.type === "function" && bodyLines > 0) ||
        (match.type === "method" && bodyLines > 0) ||
        (match.type === "arrow" && bodyLines > 0) ||
        (match.type === "object" && bodyLines > 0) ||
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
