import path from "path";
import { getEnv } from "../config";
import { processOutput } from "../editor-utils";
import { compactFile } from "../utils/compactor";
import { FileRequest, getFileLines, getTokenCount } from "../utils/read-utils";
import { validatePathAccess } from "../utils/security";

const COMPACTION_ADVISORY = `
#### COMPACTION NOTICE
Parts of these files are collapsed. Line numbers in comments are **absolute**; do not use visual line counts for offsets.
 
**To expand:** Request specific line ranges (e.g., file.ts[20,60]). Targeted requests are never compacted.
`.trim();

/**
 * Core logic for reading files, applying compaction, and calculating tokens.
 * This function returns the formatted string directly.
 */
export async function getReadContent(requests: FileRequest[]): Promise<string> {
  if (!requests || requests.length === 0)
    throw new Error("At least one file path is required.");

  const env = await getEnv();
  const tokenLimit = parseInt(env.SPEKTA_READ_TOKEN_LIMIT || "2000", 10);
  const compactThreshold = 500;
  let combinedOutput = "";
  let anyCompacted = false;

  for (const req of requests) {
    await validatePathAccess(req.path);
    const { lines, total } = await getFileLines(
      req.path,
      req.range || { start: 1, end: "$" },
    );

    const startLineOffset = req.range
      ? typeof req.range.start === "number"
        ? req.range.start
        : 1
      : 1;

    const isRangeRequest = !!req.range;
    let content = lines.join("\n");
    let tokens = 0;
    let isCompacted = false;

    if (!isRangeRequest) {
      const CHAR_THRESHOLD = compactThreshold * 4;
      if (content.length > CHAR_THRESHOLD) {
        const result = compactFile(req.path, content, startLineOffset);
        if (result.isCompacted) {
          content = result.content;
          isCompacted = true;
          anyCompacted = true;
        }
      }
    }

    tokens = getTokenCount(content);

    if (isRangeRequest && tokens > tokenLimit) {
      const errorMessage = `Error: Requested range for ${req.path} exceeds token limit (${tokens} > ${tokenLimit}). Please request a smaller range.`;
      process.stderr.write(`${errorMessage}\n`);
      combinedOutput += `\n--- ${req.path} ERROR ---\n${errorMessage}\n`;
      continue;
    }

    if (tokens > tokenLimit && !isCompacted) {
      process.stderr.write(
        `Warning: ${req.path} exceeds token limit (${tokens} > ${tokenLimit}) and could not be compacted.\n`,
      );
    }

    const ext = path.extname(req.path).slice(1) || "txt";
    const start = req.range
      ? typeof req.range.start === "number"
        ? req.range.start
        : 1
      : 1;
    const end = req.range
      ? req.range.end === "$"
        ? total
        : req.range.end
      : total;

    const rangeLabel = `${start}-${end} of ${total}`;
    const compactLabel = isCompacted ? " [COMPACTED OVERVIEW]" : "";

    combinedOutput += `#### ${req.path} (lines ${rangeLabel})${compactLabel}\n\`\`\`${ext}\n${content}\n\`\`\`\n\n`;
  }

  return anyCompacted
    ? `${COMPACTION_ADVISORY}\n\n${combinedOutput}`
    : combinedOutput;
}

export async function runRead(
  requests: FileRequest[],
  options: { save?: boolean } = {},
) {
  try {
    const finalContent = await getReadContent(requests);

    if (options.save) {
      await processOutput(finalContent, "spekta-read");
    } else {
      process.stdout.write(finalContent);
    }
  } catch (error: any) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
