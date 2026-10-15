import { getTokenCount } from "../../utils/read-utils";

export interface GitMcpResponse {
  isError: boolean;
  content: Array<{ type: "text"; text: string }>;
}

const OUTPUT_LIMIT_MESSAGE = "output_limit_exceeded";
const SHORT_GIT_ALLOWANCE_DIAGNOSTIC =
  "usage_error: Increase Git allowance or shorten MCP request ID.";

/** Measures the complete Git tool response that MCP sends over stdio. */
export function measureGitMcpResponse(
  text: string,
  isError: boolean,
  requestId?: string | number,
): number {
  if (requestId === undefined) return getTokenCount(text);
  return getTokenCount(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      result: { isError, content: [{ type: "text", text }] },
    })}\n`,
  );
}

/** Replaces any oversized Git body with an explicit, bounded failure outcome. */
export function createGitMcpResponse(
  text: string,
  isError: boolean,
  allowance: number,
  requestId?: string | number,
): GitMcpResponse {
  if (measureGitMcpResponse(text, isError, requestId) <= allowance)
    return { isError, content: [{ type: "text", text }] };

  return {
    isError: true,
    content: [{ type: "text", text: OUTPUT_LIMIT_MESSAGE }],
  };
}

/** Minimum accepted Git allowance that can carry the bounded failure marker. */
export function getMinimumGitMcpAllowance(requestId?: string | number): number {
  return measureGitMcpResponse(OUTPUT_LIMIT_MESSAGE, true, requestId);
}

/** Builds a rejected-allowance diagnostic under the configured default budget. */
export function getGitMcpAllowanceRejection(
  requestedAllowance: number,
  minimumAllowance: number,
  defaultAllowance: number,
  requestId?: string | number,
): string {
  const diagnostic = `usage_error: Git response requires at least ${minimumAllowance} tokens; increase allowance or shorten the MCP request ID.`;
  if (measureGitMcpResponse(diagnostic, true, requestId) <= defaultAllowance)
    return diagnostic;

  // ADR 202610040945 permits a bounded nonempty diagnostic when mandatory
  // correlation metadata alone leaves no room within the configured default.
  const body = SHORT_GIT_ALLOWANCE_DIAGNOSTIC;
  return getTokenCount(body) <= 64
    ? body
    : `usage_error: Git allowance ${requestedAllowance} is too small.`;
}

/** Applies the Git allowance to the complete CLI rendering, including headers. */
export function boundGitCliResponse(
  output: string,
  allowance: number,
  limitOutput: string,
): string {
  return getTokenCount(`${output}\n`) <= allowance ? output : limitOutput;
}
