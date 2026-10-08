import { getReadTokenLimit } from "../core/config";
import {
  boundFailureOutcome,
  type FailureOutcome,
  type OperationOutcome,
} from "../core/operation-outcome";
import { getTokenCount } from "../utils/read-utils";

export interface MutationResult {
  message: string;
  changed: boolean;
  appliedCount?: number;
  cliOutput?: string;
}

export type MutationOutcome = OperationOutcome<MutationResult>;

function responseTokens(
  message: string,
  requestId?: string | number,
  isError = false,
  cliOutput?: string,
): number {
  const cli = getTokenCount(cliOutput ?? `${message}\n`);
  if (requestId === undefined) return cli;
  const mcp = JSON.stringify({
    jsonrpc: "2.0",
    id: requestId,
    result: {
      ...(isError ? { isError: true } : {}),
      content: [{ type: "text", text: message }],
    },
  });
  return Math.max(cli, getTokenCount(`${mcp}\n`));
}

export function mutationFailure(
  status: FailureOutcome["status"],
  message: string,
  requestId?: string | number,
): FailureOutcome {
  const safeFallback =
    status === "policy_rejection"
      ? "Mutation rejected by workspace policy."
      : "Mutation failed.";
  return boundFailureOutcome(
    status,
    message,
    safeFallback,
    Math.max(getReadTokenLimit(), responseTokens("", requestId, true)),
    (candidate) =>
      Math.max(
        responseTokens(candidate, requestId, true),
        getTokenCount(`[ERROR] ${candidate}\n`),
      ),
  );
}

export function boundMutationSuccess(
  result: MutationResult,
  requestId?: string | number,
): MutationOutcome {
  const budget = Math.max(
    getReadTokenLimit(),
    requestId === undefined ? 0 : responseTokens("", requestId, true),
  );
  if (
    responseTokens(result.message, requestId, false, result.cliOutput) <= budget
  ) {
    return { status: "success", value: result };
  }
  const message =
    "Mutation completed; its response exceeded the response budget.";
  return {
    status: "output_limit_exceeded",
    message: responseTokens(message, requestId, true) <= budget ? message : "",
  };
}
