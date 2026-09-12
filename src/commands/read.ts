import path from "path";
import { getReadTokenLimit, getCompactThreshold } from "../core/config";
import { processOutput } from "../utils/editor-utils";
import { compactFile } from "../utils/compactor";
import { Logger } from "../utils/logger";
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

  const tokenLimit = getReadTokenLimit();
  const compactThreshold = getCompactThreshold();
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
    let fullTokens = 0;

    // Compaction applies ONLY to full files and ONLY in non-interactive mode.
    if (!isRangeRequest && !interactive) {
      fullTokens = getTokenCount(content);

      if (fullTokens > compactThreshold) {
        const result = compactFile(req.path, content, startLineOffset);
        if (result.isCompacted) {
          content = result.content;
          isCompacted = true;
          anyCompacted = true;
        }
      }
    }

    // Token counts are always calculated for output metadata.
    // Token-limit enforcement remains non-interactive-only.
    let tokens = getTokenCount(content);
    let exceedLabel = "";

    if (!interactive) {
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

    if (isRangeRequest) {
      const fullFile = await getFileLines(req.path, { start: 1, end: "$" });
      fullTokens = getTokenCount(fullFile.lines.join("\n"));
    }

    const ext = path.extname(req.path).slice(1) || "txt";
    const rangeLabel = isRangeRequest
      ? `${req.range!.start}-${req.range!.end === "$" ? total : req.range!.end} of ${total}`
      : `1-${total} (Full File)`;

    const fmt = (n: number) => n.toLocaleString("en-US");
    let tokenDetails = "";

    if (isRangeRequest) {
      tokenDetails = ` [${fmt(tokens)}/${fmt(fullTokens)} tokens]`;
    } else if (isCompacted) {
      tokenDetails = ` [COMPACTED OVERVIEW: ${fmt(tokens)}/${fmt(fullTokens)} tokens]`;
    } else {
      tokenDetails = ` [${fmt(tokens)} tokens]`;
    }

    combinedOutput += `#### ${req.path} (lines ${rangeLabel})${tokenDetails}${exceedLabel}\n\`\`\`${ext}\n${content}\n\`\`\`\n\n`;
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
