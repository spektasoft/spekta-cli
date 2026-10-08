import { getReadTokenLimit } from "../core/config";
import { processOutput } from "../utils/editor-utils";
import { Logger } from "../utils/logger";
import { FileRequest, getFileLines, getTokenCount } from "../utils/read-utils";
import { validateReadPathAccess } from "../utils/security";
import {
  resolveWorkspace,
  type ResolvedWorkspace,
  type WorkspaceContext,
} from "../utils/workspace";
import { analyzeFile } from "../utils/file-analyzer";
import {
  boundFailureOutcome,
  getOutcomeText,
  type FailureOutcome,
  type OperationOutcome,
} from "../core/operation-outcome";
import { formatReadOutput, prependCompactionAdvisory } from "./read-formatter";

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

function boundedReadFailure(
  status: FailureOutcome["status"],
  message: string,
  requestId?: string | number,
): FailureOutcome {
  const budget =
    requestId === undefined
      ? getReadTokenLimit()
      : Math.max(
          getReadTokenLimit(),
          getMinimumMcpReadResponseBudget(requestId),
        );
  const fallback =
    status === "policy_rejection"
      ? "Read rejected by workspace policy."
      : status === "engine_failure"
        ? "Read failed."
        : "Read too large; narrow the request.";
  return boundFailureOutcome(status, message, fallback, budget, (candidate) =>
    Math.max(
      responseTokens(candidate, requestId, true),
      getTokenCount(`[ERROR] ${candidate}\n`),
    ),
  );
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
    return boundedReadFailure(
      "policy_rejection",
      "Read requires at least one file path.",
      requestId,
    );

  let resolvedWorkspace: ResolvedWorkspace;
  try {
    resolvedWorkspace = await resolveWorkspace(workspace);
  } catch {
    return boundedReadFailure(
      "policy_rejection",
      "Read rejected: workspace is unavailable.",
      requestId,
    );
  }
  const tokenLimit = getReadTokenLimit();
  let combinedOutput = "";
  let anyCompacted = false;

  for (const req of requests) {
    const isRangeRequest = !!req.range;
    let readPath: string;
    try {
      readPath = await validateReadPathAccess(req.path, resolvedWorkspace);
    } catch {
      return boundedReadFailure(
        "policy_rejection",
        "Read rejected: one or more requested files are unavailable under workspace policy.",
        requestId,
      );
    }

    try {
      if (!isRangeRequest && !interactive) {
        const analysis = await analyzeFile(req.path, resolvedWorkspace);
        const content = analysis.content;
        const total = analysis.totalLines;
        const isCompacted = analysis.isCompacted;
        const fullTokens = analysis.rawTokens;
        const compactionWarning = analysis.compactionWarning ?? "";

        if (isCompacted) anyCompacted = true;

        const tokens = analysis.finalTokens;
        const exceedsLimit = analysis.exceedsLimit;

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

      const { lines, total: rangeTotal } = await getFileLines(
        readPath,
        req.range || { start: 1, end: "$" },
      );
      const total = rangeTotal;

      const content = lines.join("\n");
      const tokens = getTokenCount(content);

      if (!interactive && tokens > tokenLimit) {
        return boundedReadFailure(
          "output_limit_exceeded",
          "Requested read exceeds the response budget; request a narrower line range.",
          requestId,
        );
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
    } catch {
      return boundedReadFailure(
        "engine_failure",
        "Read failed while accessing an authorized file.",
        requestId,
      );
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

    if (
      outcome.status === "policy_rejection" ||
      outcome.status === "engine_failure" ||
      outcome.status === "output_limit_exceeded"
    ) {
      process.exitCode = 1;
    }

    if (options.save) {
      await processOutput(finalContent, "spekta-read");
    } else {
      process.stdout.write(finalContent);
    }
  } catch {
    const failure = boundedReadFailure("engine_failure", "Read failed.");
    if (failure.message) Logger.error(failure.message);
    process.exitCode = 1;
  }
}
