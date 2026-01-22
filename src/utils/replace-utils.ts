import { createReadStream } from "fs";
import fs from "fs-extra";
import readline from "readline";
import { LineRange } from "./read-utils";

export interface ReplaceBlock {
  search: string;
  replace: string;
}

export interface ReplaceRequest {
  path: string;
  range: LineRange;
  blocks: ReplaceBlock[];
}

const SEARCH_MARKER = "<<<<<<< SEARCH";
const SEPARATOR = "=======";
const REPLACE_MARKER = ">>>>>>> REPLACE";

/**
 * Checks if the file content contains existing Git conflict markers.
 */
export const containsConflictMarkers = (content: string): boolean => {
  const markers = ["<<<<<<< ", "=======", ">>>>>>> "];
  return markers.some((m) => content.includes(m));
};

/**
 * Detects the line ending used in the content.
 */
export const detectLineEnding = (content: string): string => {
  const temp = content.indexOf("\r\n");
  if (temp !== -1) return "\r\n";
  return "\n";
};

/**
 * Reconstructs the file while preserving original line endings.
 */
const reconstructFile = (lines: string[], lineEnding: string): string => {
  return lines.join(lineEnding);
};

/**
 * Normalizes the end index for a range.
 */
export const getEndIndex = (end: number | "$", totalLines: number): number => {
  return end === "$" ? totalLines : end;
};

/**
 * Normalizes whitespace for comparison while preserving content.
 * - Converts CRLF to LF
 * - Converts tabs to spaces (2 spaces per tab)
 * - Trims trailing whitespace per line
 * - Trims leading/trailing empty lines
 */
export const normalizeWhitespace = (text: string): string => {
  let lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, "  ").replace(/[ \t]+$/, "")); // Only trim trailing whitespace

  // Remove leading empty lines
  while (lines.length > 0 && lines[0] === "") {
    lines.shift();
  }

  // Remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
};

/**
 * Parses SEARCH/REPLACE blocks from input text.
 * Supports multiple blocks in a single input.
 */
export const parseReplaceBlocks = (input: string): ReplaceBlock[] => {
  const blocks: ReplaceBlock[] = [];
  const lines = input.split("\n");
  let i = 0;

  while (i < lines.length) {
    // Find SEARCH marker
    if (lines[i].trim() === SEARCH_MARKER) {
      const searchLines: string[] = [];
      i++;

      // Collect search content until separator
      while (i < lines.length && lines[i].trim() !== SEPARATOR) {
        searchLines.push(lines[i]);
        i++;
      }

      if (i >= lines.length) {
        throw new Error("Invalid format: Missing separator '======='");
      }

      i++; // Skip separator

      const replaceLines: string[] = [];

      // Collect replace content until REPLACE marker
      while (i < lines.length && lines[i].trim() !== REPLACE_MARKER) {
        replaceLines.push(lines[i]);
        i++;
      }

      if (i >= lines.length) {
        throw new Error("Invalid format: Missing '>>>>>>> REPLACE' marker");
      }

      blocks.push({
        search: searchLines.join("\n"),
        replace: replaceLines.join("\n"),
      });

      i++; // Skip REPLACE marker
    } else {
      i++;
    }
  }

  if (blocks.length === 0) {
    throw new Error(
      "No SEARCH/REPLACE blocks found. Use format:\n" +
        "<<<<<<< SEARCH\n[content]\n=======\n[replacement]\n>>>>>>> REPLACE",
    );
  }

  return blocks;
};

/**
 * Reads file lines within a range.
 */
export const getFileLinesForEdit = async (
  filePath: string,
  range: LineRange,
): Promise<{ lines: string[]; totalLines: number }> => {
  const fileContent = await fs.readFile(filePath, "utf-8");

  // Check for existing Git conflict markers
  if (containsConflictMarkers(fileContent)) {
    throw new Error(
      "File contains existing Git conflict markers. Resolve conflicts before reading file lines for edit.",
    );
  }

  const fileStream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const allLines: string[] = [];
  let currentLine = 0;

  for await (const line of rl) {
    currentLine++;
    allLines.push(line);
  }

  const startLine = range.start;
  const endLine = getEndIndex(range.end, allLines.length);

  if (startLine < 1 || startLine > allLines.length) {
    throw new Error(
      `Invalid range: start line ${startLine} is out of bounds (1-${allLines.length})`,
    );
  }

  if (endLine < startLine) {
    throw new Error(
      `Invalid range: end line ${endLine} is before start line ${startLine}`,
    );
  }

  const lines = allLines.slice(startLine - 1, endLine);
  return { lines, totalLines: allLines.length };
};

/**
 * Applies replacement blocks to file content within specified range.
 * Returns the complete updated file content.
 */
export const applyReplacements = async (
  filePath: string,
  range: LineRange,
  blocks: ReplaceBlock[],
): Promise<{ content: string; appliedCount: number }> => {
  const fileContent = await fs.readFile(filePath, "utf-8");

  // Check for existing Git conflict markers
  if (containsConflictMarkers(fileContent)) {
    throw new Error(
      "File contains existing Git conflict markers. Resolve conflicts before applying replacements.",
    );
  }

  const lineEnding = detectLineEnding(fileContent);
  const allLines = fileContent.split(lineEnding);

  const startIdx = range.start - 1;
  const endIdx = getEndIndex(range.end, allLines.length);

  // Get the range content
  const rangeContent = allLines.slice(startIdx, endIdx).join(lineEnding);
  let modifiedRange = rangeContent;
  let appliedCount = 0;

  for (const block of blocks) {
    const search = block.search.replace(/\n/g, lineEnding);
    const replace = block.replace.replace(/\n/g, lineEnding);

    // Try exact match first
    if (modifiedRange.includes(search)) {
      modifiedRange = modifiedRange.replace(search, replace);
      appliedCount++;
    } else {
      // If exact match fails, try normalized match
      const normalizedRange = normalizeWhitespace(modifiedRange);
      const normalizedSearch = normalizeWhitespace(block.search);

      if (!normalizedRange.includes(normalizedSearch)) {
        throw new Error(
          `Search block not found in specified range:\n${block.search}`,
        );
      }

      // Find all possible positions where the normalized search could match
      const positions = findAllPositions(normalizedRange, normalizedSearch);

      if (positions.length > 1) {
        throw new Error(
          `Search block found multiple times in range. Please narrow the range or make the search more specific:\n${block.search}`,
        );
      }

      // Get the actual substring from the original content that corresponds to the normalized match
      const actualMatch = getActualSubstringFromNormalizedPosition(
        modifiedRange,
        positions[0],
        normalizedSearch,
      );

      if (actualMatch) {
        modifiedRange = modifiedRange.replace(actualMatch, replace);
        appliedCount++;
      } else {
        throw new Error(
          `Could not locate exact match for search block:\n${block.search}`,
        );
      }
    }
  }

  // Reconstruct full file
  const updatedLines = [
    ...allLines.slice(0, startIdx),
    ...modifiedRange.split(lineEnding),
    ...allLines.slice(endIdx),
  ];

  return {
    content: reconstructFile(updatedLines, lineEnding),
    appliedCount,
  };
};

/**
 * Finds all starting positions of a substring within a string
 */
const findAllPositions = (str: string, searchStr: string): number[] => {
  const positions = [];
  let pos = str.indexOf(searchStr);

  while (pos !== -1) {
    positions.push(pos);
    pos = str.indexOf(searchStr, pos + 1);
  }

  return positions;
};

/**
 * Gets the actual substring from the original text that corresponds to the normalized match
 */
const getActualSubstringFromNormalizedPosition = (
  originalText: string,
  normalizedPos: number,
  normalizedMatch: string,
): string | null => {
  // This is a simplified approach - we'll try to find the actual substring
  // by testing different possible substrings from the original text
  const originalLines = originalText.split("\n");
  const normalizedLines = normalizeWhitespace(originalText).split("\n");

  // Since this is complex, we'll use a simpler approach:
  // Find all possible substrings of similar length and normalize them to see which matches
  for (let i = 0; i < originalText.length; i++) {
    for (
      let len = normalizedMatch.length;
      len <= normalizedMatch.length + 20;
      len++
    ) {
      // Allow some flexibility
      if (i + len > originalText.length) continue;

      const candidate = originalText.substring(i, i + len);
      if (normalizeWhitespace(candidate) === normalizedMatch) {
        return candidate;
      }
    }
  }

  return null;
};
