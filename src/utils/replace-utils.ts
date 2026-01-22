import fs from "fs-extra";

export interface ReplaceBlock {
  search: string;
  replace: string;
}

export interface ReplaceRequest {
  path: string;
  blocks: ReplaceBlock[];
}

export interface AppliedBlock {
  startLine: number;
  endLine: number;
  originalText: string;
  replacementText: string;
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
 * Finds the exact start and end character offsets of a search string
 * within the original content, ignoring whitespace differences.
 */
export const findUniqueMatch = (
  content: string,
  search: string,
): { start: number; end: number } => {
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  const normalizedContent = normalize(content);
  const normalizedSearch = normalize(search);

  // Map normalized index back to original index
  // We need to find where the normalized search starts and ends in the original content
  // by tracking character positions.
  const contentChars = [...content];
  let normalizedContentBuilder = "";
  const originalIndices: number[] = [];

  for (let i = 0; i < contentChars.length; i++) {
    const char = contentChars[i];
    if (/\s/.test(char)) {
      if (
        normalizedContentBuilder.length > 0 &&
        !normalizedContentBuilder.endsWith(" ")
      ) {
        normalizedContentBuilder += " ";
        originalIndices.push(i);
      }
    } else {
      normalizedContentBuilder += char;
      originalIndices.push(i);
    }
  }

  const normalizedContentFinal = normalizedContentBuilder.trim();
  // Adjust originalIndices to match the trimmed normalizedContentFinal
  const leadingSpaces =
    normalizedContentBuilder.length -
    normalizedContentBuilder.trimStart().length;
  const finalIndices = originalIndices.slice(
    leadingSpaces,
    leadingSpaces + normalizedContentFinal.length,
  );

  const occurrences = [];
  let pos = normalizedContentFinal.indexOf(normalizedSearch);

  while (pos !== -1) {
    occurrences.push(pos);
    pos = normalizedContentFinal.indexOf(normalizedSearch, pos + 1);
  }

  if (occurrences.length === 0) {
    throw new Error(
      "The search block was not found in the file. Ensure the search block matches the file content exactly (ignoring indentation).",
    );
  }

  if (occurrences.length > 1) {
    throw new Error(
      `Ambiguous match: Found ${occurrences.length} occurrences of the search block. Please provide more surrounding context to uniquely identify the target.`,
    );
  }

  const matchStartNormalized = occurrences[0];
  const matchEndNormalized = matchStartNormalized + normalizedSearch.length;

  const start = finalIndices[matchStartNormalized];
  // For the end index, we take the index of the last character in the match and add 1
  // If the match is empty (shouldn't happen here), we'd need to handle it.
  const end = finalIndices[matchEndNormalized - 1] + 1;

  return { start, end };
};

/**
 * Maps a character offset to its corresponding line number (1-indexed).
 */
export const getLineNumberFromOffset = (
  content: string,
  offset: number,
): number => {
  return content.substring(0, offset).split(/\r?\n/).length;
};

/**
 * Calculates the total line count of a string.
 */
export const getTotalLines = (content: string): number => {
  return content.split(/\r?\n/).length;
};

/**
 * Applies replacement blocks to file content.
 * Returns the complete updated file content.
 */
export const applyReplacements = async (
  filePath: string,
  blocks: ReplaceBlock[],
): Promise<{
  content: string;
  appliedBlocks: AppliedBlock[];
  totalLines: number;
}> => {
  let fileContent = await fs.readFile(filePath, "utf-8");

  // Check for existing Git conflict markers
  if (containsConflictMarkers(fileContent)) {
    throw new Error(
      "File contains existing Git conflict markers. Resolve conflicts before applying replacements.",
    );
  }

  const lineEnding = detectLineEnding(fileContent);
  const appliedBlocks: AppliedBlock[] = [];

  for (const block of blocks) {
    const match = findUniqueMatch(fileContent, block.search);
    const startLine = getLineNumberFromOffset(fileContent, match.start);
    const endLine = getLineNumberFromOffset(fileContent, match.end);
    const originalText = fileContent.substring(match.start, match.end);

    // Ensure replacement uses the correct line endings
    const replace = block.replace.replace(/\r?\n/g, lineEnding);

    appliedBlocks.push({
      startLine,
      endLine,
      originalText,
      replacementText: replace,
    });

    fileContent =
      fileContent.substring(0, match.start) +
      replace +
      fileContent.substring(match.end);
  }

  return {
    content: fileContent,
    appliedBlocks,
    totalLines: getTotalLines(fileContent),
  };
};
