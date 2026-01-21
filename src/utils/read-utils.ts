import { createReadStream } from "fs";
import { encode } from "gpt-tokenizer";
import readline from "readline";

export interface LineRange {
  start: number;
  end: number | "$";
}

export interface FileRequest {
  path: string;
  range?: LineRange;
}

export const parseRange = (rangeStr: string | undefined): LineRange => {
  if (!rangeStr || rangeStr === "1,$") return { start: 1, end: "$" };
  const match = rangeStr.match(/^(\d+),(\d+|\$)$/);
  if (!match)
    throw new Error(
      "Invalid range format. Use 'start,end' (e.g., 10,20 or 50,$).",
    );

  const start = parseInt(match[1], 10);
  const end = match[2] === "$" ? "$" : parseInt(match[2], 10);

  return { start, end };
};

/**
 * Parses a path string like "file.ts[10,20]" into path and range.
 */
export const parseFilePathWithRange = (input: string): FileRequest => {
  const match = input.match(/^(.*)\[(\d+|\$)?(?:,(\d+|\$))?\]$/);
  if (!match) {
    return { path: input };
  }

  const filePath = match[1];
  const startRaw = match[2];
  const endRaw = match[3];

  const range: LineRange = {
    start:
      startRaw === undefined || startRaw === "" ? 1 : parseInt(startRaw, 10),
    end:
      endRaw === undefined || endRaw === ""
        ? "$"
        : endRaw === "$"
          ? "$"
          : parseInt(endRaw, 10),
  };

  return { path: filePath, range };
};

export const getFileLines = async (
  filePath: string,
  range: LineRange,
): Promise<{ lines: string[]; total: number }> => {
  const fileStream = createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const lines: string[] = [];
  let currentLine = 0;
  const startLine = range.start;
  const endLine = range.end === "$" ? Infinity : range.end;

  for await (const line of rl) {
    currentLine++;
    if (currentLine >= startLine && currentLine <= endLine) {
      lines.push(line);
    }
    // Optimization: Stop reading if we passed the end of the range
    if (currentLine >= endLine && range.end !== "$") {
      rl.close();
      fileStream.destroy();
      break;
    }
  }

  return { lines, total: currentLine };
};

export const getTokenCount = (text: string): number => {
  return encode(text).length;
};
