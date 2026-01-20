import { encode } from "gpt-tokenizer";
import fs from "fs-extra";

export interface LineRange {
  start: number;
  end: number | "$";
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

export const getFileLines = async (
  filePath: string,
  range: LineRange,
): Promise<{ lines: string[]; total: number }> => {
  const content = await fs.readFile(filePath, "utf-8");
  const allLines = content.split("\n");
  const total = allLines.length;

  const startIdx = Math.max(0, range.start - 1);
  const endIdx = range.end === "$" ? total : Math.min(total, range.end);

  return {
    lines: allLines.slice(startIdx, endIdx),
    total,
  };
};

export const getTokenCount = (text: string): number => {
  return encode(text).length;
};
