import path from "path";
import { getEnv } from "../config";
import { processOutput } from "../editor-utils";
import { Logger } from "../utils/logger";
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
export async function getReadContent(
  requests: FileRequest[],
  interactive = false,
): Promise<string> {
  if (!requests || requests.length === 0)
    throw new Error("At least one file path is required.");

  const env = await getEnv();
  const tokenLimit = parseInt(env.SPEKTA_READ_TOKEN_LIMIT || "1000", 10);
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
    let isCompacted = false;

    // Compaction applies ONLY to full files (no range), regardless of mode
    if (!isRangeRequest) {
      if (content.length > compactThreshold) {
        const result = compactFile(req.path, content, startLineOffset);
        if (result.isCompacted) {
          content = result.content;
          isCompacted = true;
          anyCompacted = true;
        }
      }
    }

    // Token counting ONLY for non-interactive mode enforcement
    let tokens = 0;
    let exceedLabel = "";
    if (!interactive) {
      tokens = getTokenCount(content);
      if (tokens > tokenLimit) {
        if (isRangeRequest) {
          const errorMessage = `Requested range for ${req.path} exceeds token limit (${tokens} > ${tokenLimit}).`;
          Logger.error(errorMessage);
          combinedOutput += `#### ${req.path} ERROR\nError: ${errorMessage}\n\n`;
          continue;
        } else if (!isCompacted) {
          Logger.warn(
            `${req.path} exceeds token limit (${tokens} > ${tokenLimit}) and could not be compacted.`,
          );
        }
        exceedLabel = " [EXCEEDS TOKEN LIMIT]";
      }
    }

    const ext = path.extname(req.path).slice(1) || "txt";
    const rangeLabel = isRangeRequest
      ? `${req.range!.start}-${req.range!.end === "$" ? total : req.range!.end} of ${total}`
      : `1-${total} (Full File)`;
    const compactLabel = isCompacted ? " [COMPACTED OVERVIEW]" : "";
    combinedOutput += `#### ${req.path} (lines ${rangeLabel})${compactLabel}${exceedLabel}\n\`\`\`${ext}\n${content}\n\`\`\`\n\n`;
  }

  return anyCompacted
    ? `${COMPACTION_ADVISORY}\n\n${combinedOutput}`
    : combinedOutput;
}

export async function runRead(
  requests: FileRequest[],
  options: { save?: boolean; interactive?: boolean } = {},
) {
  try {
    const finalContent = await getReadContent(
      requests,
      options.interactive ?? false,
    );

    if (options.save) {
      await processOutput(finalContent, "spekta-read");
    } else {
      process.stdout.write(finalContent);
    }
  } catch (error: any) {
    Logger.error(error.message);
    process.exitCode = 1;
  }
}
