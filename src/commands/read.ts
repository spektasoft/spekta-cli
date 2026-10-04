import { getReadTokenLimit } from "../core/config";
import { processOutput } from "../utils/editor-utils";
import { Logger } from "../utils/logger";
import { FileRequest, getFileLines, getTokenCount } from "../utils/read-utils";
import { validateReadPathAccess } from "../utils/security";
import { resolveWorkspace, type WorkspaceContext } from "../utils/workspace";
import { analyzeFile } from "../utils/file-analyzer";
import {
  getOutcomeText,
  type OperationOutcome,
} from "../core/operation-outcome";
import {
  formatReadOutput,
  formatReadError,
  prependCompactionAdvisory,
} from "./read-formatter";

function responseTokens(
  text: string,
  requestId?: string | number,
  isError = false,
): number {
  const cli = getTokenCount(`${text}\n`);
  if (requestId === undefined) return cli;
  const mcp = JSON.stringify({
    jsonrpc: "2.0",
    id: requestId,
    result: {
      ...(isError ? { isError: true } : {}),
      content: [{ type: "text", text }],
    },
  });
  return Math.max(cli, getTokenCount(`${mcp}\n`));
}

const READ_LIMIT_GUIDANCE =
  "Read result exceeds the response budget; content is incomplete. Request a narrower path or line range.";

export function getMinimumMcpReadResponseBudget(
  requestId: string | number,
): number {
  return responseTokens("", requestId, true);
}

function fitIncomplete(
  content: string,
  budget: number,
  requestId?: string | number,
): string {
  const marker =
    "[INCOMPLETE: response budget reached; request a narrower line range.]\n";
  let low = 0;
  let high = content.length;
  let best = "";
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = `${content.slice(0, middle)}${marker}`;
    if (responseTokens(candidate, requestId, true) <= budget) {
      best = candidate;
      low = middle + 1;
    } else high = middle - 1;
  }
  return (
    best ||
    (responseTokens(READ_LIMIT_GUIDANCE, requestId, true) <= budget
      ? READ_LIMIT_GUIDANCE
      : "")
  );
}

export function boundReadResponse(
  content: string,
  requestId?: string | number,
): OperationOutcome<string> {
  const configuredBudget = getReadTokenLimit();
  const budget =
    requestId === undefined
      ? configuredBudget
      : Math.max(configuredBudget, getMinimumMcpReadResponseBudget(requestId));
  if (responseTokens(content, requestId) <= budget)
    return { status: "success", value: content };
  return {
    status: "output_limit_exceeded",
    message: fitIncomplete(content, budget, requestId),
  };
}

/**
 * Core logic for reading files, applying compaction, and calculating tokens.
 * This function returns the formatted string directly.
 */
export async function getReadOutcome(
  requests: FileRequest[],
  interactive = false,
  workspace?: WorkspaceContext,
  requestId?: string | number,
): Promise<OperationOutcome<string>> {
  if (!requests || requests.length === 0)
    throw new Error("At least one file path is required.");

  const resolvedWorkspace = await resolveWorkspace(workspace);
  const tokenLimit = getReadTokenLimit();
  let combinedOutput = "";
  let anyCompacted = false;

  for (const req of requests) {
    const isRangeRequest = !!req.range;

    if (!isRangeRequest && !interactive) {
      const analysis = await analyzeFile(req.path, resolvedWorkspace);
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
      const readPath = await validateReadPathAccess(
        req.path,
        resolvedWorkspace,
      );
      const { lines, total: rangeTotal } = await getFileLines(
        readPath,
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
        const fullFile = await getFileLines(readPath, { start: 1, end: "$" });
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

  const output = anyCompacted
    ? prependCompactionAdvisory(combinedOutput)
    : combinedOutput;
  return boundReadResponse(output, requestId);
}

/** Compatibility renderer for existing internal string consumers. */
export async function getReadContent(
  requests: FileRequest[],
  interactive = false,
  workspace?: WorkspaceContext,
  requestId?: string | number,
): Promise<string> {
  const outcome = await getReadOutcome(
    requests,
    interactive,
    workspace,
    requestId,
  );
  return getOutcomeText(outcome);
}

export async function runRead(
  requests: FileRequest[],
  options: {
    save?: boolean;
    interactive?: boolean;
    workspace?: WorkspaceContext;
  } = {},
) {
  try {
    const outcome = await getReadOutcome(
      requests,
      options.interactive ?? false,
      options.workspace,
    );
    const finalContent = getOutcomeText(outcome);

    if (outcome.status === "output_limit_exceeded") {
      Logger.warn(
        "Read response exceeded the response budget; output is incomplete.",
      );
      process.exitCode = 1;
    }

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
