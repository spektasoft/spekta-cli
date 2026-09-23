import { getReadTokenLimit } from "../core/config";
import { processOutput } from "../utils/editor-utils";
import { Logger } from "../utils/logger";
import { FileRequest, getFileLines, getTokenCount } from "../utils/read-utils";
import { validatePathAccess } from "../utils/security";
import { analyzeFile } from "../utils/file-analyzer";
import {
  formatReadOutput,
  formatReadError,
  prependCompactionAdvisory,
} from "./read-formatter";

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
  let combinedOutput = "";
  let anyCompacted = false;

  for (const req of requests) {
    const isRangeRequest = !!req.range;

    if (!isRangeRequest && !interactive) {
      const analysis = await analyzeFile(req.path);
      const content = analysis.content;
      const total = analysis.totalLines;
      const isCompacted = analysis.isCompacted;
      const fullTokens = analysis.rawTokens;
      const compactionWarning = analysis.compactionWarning ?? "";

      if (compactionWarning) {
        Logger.warn(compactionWarning);
      }

      if (isCompacted) {
        anyCompacted = true;
      }

      const tokens = analysis.finalTokens;
      const exceedsLimit = analysis.exceedsLimit;

      if (exceedsLimit && !isCompacted) {
        Logger.warn(
          `${req.path} exceeds token limit (${tokens} > ${tokenLimit}) and could not be compacted.`,
        );
      }

      combinedOutput += formatReadOutput({
        path: req.path,
        content,
        total,
        isRangeRequest: false,
        tokens,
        fullTokens,
        isCompacted,
        exceedsLimit,
        warning: compactionWarning,
      });
      continue;
    }

    try {
      await validatePathAccess(req.path);
      const { lines, total: rangeTotal } = await getFileLines(
        req.path,
        req.range || { start: 1, end: "$" },
      );
      const total = rangeTotal;

      const content = lines.join("\n");
      const tokens = getTokenCount(content);

      if (!interactive && tokens > tokenLimit) {
        const errorMessage = `Requested range for ${req.path} exceeds token limit (${tokens} > ${tokenLimit}).`;
        Logger.error(errorMessage);
        combinedOutput += formatReadError(req.path, errorMessage);
        continue;
      }

      let fullTokens = tokens;
      if (isRangeRequest) {
        const fullFile = await getFileLines(req.path, { start: 1, end: "$" });
        fullTokens = getTokenCount(fullFile.lines.join("\n"));
      }

      combinedOutput += formatReadOutput({
        path: req.path,
        content,
        total,
        isRangeRequest,
        rangeStart: req.range?.start,
        rangeEnd: req.range?.end,
        tokens,
        fullTokens,
        exceedsLimit: !interactive && tokens > tokenLimit,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      combinedOutput += formatReadError(req.path, message);
    }
  }

  return anyCompacted
    ? prependCompactionAdvisory(combinedOutput)
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    Logger.error(message);
    process.exitCode = 1;
  }
}
