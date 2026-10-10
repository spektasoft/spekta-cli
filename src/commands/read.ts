import fs from "fs-extra";
import { getEnv, getReadTokenLimit } from "../core/config";
import { getTempPath } from "../utils/fs-utils";
import { openEditor } from "../utils/editor-utils";
import {
  FileRequest,
  getFileLines,
  getTokenCount,
  parseFilePathWithRange,
} from "../utils/read-utils";
import { validateReadPathAccess } from "../utils/security";
import {
  resolveWorkspace,
  type ResolvedWorkspace,
  type WorkspaceContext,
} from "../utils/workspace";
import {
  boundFailureOutcome,
  getOutcomeText,
  type FailureOutcome,
  type OperationOutcome,
} from "../core/operation-outcome";
import { formatReadOutput } from "./read-formatter";

function responseTokens(
  text: string,
  requestId?: string | number,
  isError = false,
  suffix = "",
): number {
  const cli = getTokenCount(`${text}${suffix}`);
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
  "output_limit_exceeded: Read result exceeds the response budget. Request a narrower path or line range.";

export function getMinimumMcpReadResponseBudget(
  requestId: string | number,
): number {
  return responseTokens("", requestId, true);
}

function boundedReadFailure(
  status: FailureOutcome["status"],
  message: string,
  requestId?: string | number,
  suffix = "",
): FailureOutcome {
  const budget =
    requestId === undefined
      ? getReadTokenLimit()
      : Math.max(
          getReadTokenLimit(),
          getMinimumMcpReadResponseBudget(requestId),
        );
  const fallback =
    status === "usage_error"
      ? "usage_error: Use spekta help read."
      : status === "policy_rejection"
        ? "unavailable_access: Read rejected by workspace policy."
        : status === "engine_failure"
          ? "internal_failure: Read failed."
          : "output_limit_exceeded: Narrow the read range.";
  return boundFailureOutcome(status, message, fallback, budget, (candidate) =>
    Math.max(
      responseTokens(candidate, requestId, true, suffix),
      getTokenCount(`${candidate}${suffix}`),
    ),
  );
}

export function readUsageFailure(requestId?: string | number): FailureOutcome {
  return boundedReadFailure(
    "usage_error",
    "usage_error: Read requires literal paths with inclusive positive line ranges. Use spekta help read.",
    requestId,
  );
}

export function parseReadRequests(paths: string[]): FileRequest[] {
  return paths.map((operand) => {
    if (!operand || operand.startsWith("-"))
      throw new Error("Invalid read operand");
    const request = parseFilePathWithRange(operand);
    if (!validReadRequest(request)) throw new Error("Invalid read range");
    return request;
  });
}

function validReadRequest(request: FileRequest): boolean {
  return (
    typeof request.path === "string" &&
    request.path.length > 0 &&
    (!request.range ||
      (Number.isSafeInteger(request.range.start) &&
        request.range.start > 0 &&
        (request.range.end === "$" ||
          (Number.isSafeInteger(request.range.end) &&
            request.range.end >= request.range.start))))
  );
}

export function boundReadResponse(
  content: string,
  requestId?: string | number,
  suffix = "",
): OperationOutcome<string> {
  const configuredBudget = getReadTokenLimit();
  const budget =
    requestId === undefined
      ? configuredBudget
      : Math.max(configuredBudget, getMinimumMcpReadResponseBudget(requestId));
  if (responseTokens(content, requestId, false, suffix) <= budget)
    return { status: "success", value: content };
  return {
    status: "output_limit_exceeded",
    message: boundedReadFailure(
      "output_limit_exceeded",
      READ_LIMIT_GUIDANCE,
      requestId,
      suffix,
    ).message,
  };
}

/**
 * Plan original-line reads against the complete transport response budget.
 */
export async function getReadOutcome(
  requests: FileRequest[],
  _interactive = false,
  workspace?: WorkspaceContext,
  requestId?: string | number,
  suffix = "",
): Promise<OperationOutcome<string>> {
  // Retain the interactive parameter for existing callers; all reads share planning.
  void _interactive;
  if (
    !requests ||
    requests.length === 0 ||
    requests.some((request) => !validReadRequest(request))
  )
    return readUsageFailure(requestId);

  let resolvedWorkspace: ResolvedWorkspace;
  try {
    resolvedWorkspace = await resolveWorkspace(workspace);
  } catch {
    return boundedReadFailure(
      "policy_rejection",
      "Read rejected: unavailable_access; workspace is unavailable.",
      requestId,
      suffix,
    );
  }
  const tokenLimit = getReadTokenLimit();
  let combinedOutput = "";

  for (const [position, req] of requests.entries()) {
    const isRangeRequest = !!req.range;
    let readPath: string;
    try {
      readPath = await validateReadPathAccess(req.path, resolvedWorkspace);
    } catch {
      return boundedReadFailure(
        "policy_rejection",
        `Read rejected: unavailable_access; Operand ${position + 1} is unavailable under workspace policy.`,
        requestId,
        suffix,
      );
    }

    try {
      const { lines, total: rangeTotal } = await getFileLines(
        readPath,
        req.range || { start: 1, end: "$" },
      );
      const total = rangeTotal;

      const content = lines.join("\n");
      const tokens = getTokenCount(content);

      let fullTokens = tokens;
      if (isRangeRequest) {
        const fullFile = await getFileLines(readPath, { start: 1, end: "$" });
        fullTokens = getTokenCount(fullFile.lines.join("\n"));
      }

      const start = req.range?.start ?? 1;
      const render = (count: number) => {
        const chunk = lines.slice(0, count).join("\n");
        const end = start + count - 1;
        const incomplete = count < lines.length;
        const body = formatReadOutput({
          path: req.path,
          content: chunk,
          total,
          isRangeRequest: isRangeRequest || incomplete,
          rangeStart: start,
          rangeEnd: end,
          tokens: getTokenCount(chunk),
          fullTokens,
          empty: count === 0,
        });
        return incomplete
          ? `${body}[INCOMPLETE: output_limit_exceeded; Next range: ${req.path}[${end + 1},${start + lines.length - 1}]]\n`
          : body;
      };
      const complete = render(lines.length);
      const budget =
        requestId === undefined
          ? tokenLimit
          : Math.max(tokenLimit, getMinimumMcpReadResponseBudget(requestId));
      if (
        requests.length === 1 &&
        responseTokens(complete, requestId, false, suffix) > budget
      ) {
        let low = 1;
        let high = lines.length - 1;
        let best = "";
        while (low <= high) {
          const count = Math.floor((low + high) / 2);
          const candidate = render(count);
          if (responseTokens(candidate, requestId, true, suffix) <= budget) {
            best = candidate;
            low = count + 1;
          } else high = count - 1;
        }
        return best
          ? { status: "output_limit_exceeded", message: best }
          : boundedReadFailure(
              "output_limit_exceeded",
              `output_limit_exceeded: Operand 1 line ${start} cannot fit with read metadata. Increase SPEKTA_READ_TOKEN_LIMIT or request a smaller range; lines are never shortened.`,
              requestId,
              suffix,
            );
      }
      combinedOutput += complete;
    } catch {
      return boundedReadFailure(
        "engine_failure",
        `Read failed: internal_failure while accessing authorized Operand ${position + 1}.`,
        requestId,
        suffix,
      );
    }
  }

  return boundReadResponse(combinedOutput, requestId, suffix);
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
    const savedPath = options.save ? getTempPath("spekta-read") : undefined;
    const suffix = savedPath ? `Output saved to: ${savedPath}\n` : "";
    if (responseTokens(suffix) > getReadTokenLimit()) {
      process.stdout.write(
        getOutcomeText(
          boundedReadFailure(
            "output_limit_exceeded",
            "output_limit_exceeded: Save metadata exceeds the response budget; increase SPEKTA_READ_TOKEN_LIMIT or omit --save.",
          ),
        ),
      );
      process.exitCode = 1;
      return;
    }
    const outcome = await getReadOutcome(
      requests,
      options.interactive ?? false,
      options.workspace,
      undefined,
      suffix,
    );
    const finalContent = getOutcomeText(outcome);
    if (outcome.status !== "success") process.exitCode = 1;

    if (savedPath) {
      await fs.writeFile(savedPath, finalContent, "utf8");
      const env = await getEnv();
      if (env.SPEKTA_EDITOR && env.SPEKTA_NO_EDITOR !== "1") {
        await openEditor(env.SPEKTA_EDITOR, savedPath);
        process.stdout.write(suffix);
      } else {
        process.stdout.write(`${finalContent}${suffix}`);
      }
    } else {
      process.stdout.write(finalContent);
    }
  } catch {
    const failure = boundedReadFailure(
      "engine_failure",
      "internal_failure: Read failed.",
    );
    process.stdout.write(failure.message);
    process.exitCode = 1;
  }
}
