import { renderGitStatusOutcome } from "../../commands/proxy/proxy-git-status";
import { renderGitBranchOutcome } from "../../commands/proxy/proxy-git-branch";
import { renderGitHistoryOutcome } from "../../commands/proxy/proxy-git-history";
import { renderGitBlobOutcome } from "../../commands/proxy/proxy-git-blob";
import {
  executeGitHistoryPatchOutcome,
  isGitHistoryPatchRequest,
} from "../../commands/proxy/proxy-git-history-patch";
import {
  executeGitDiffPatchOutcome,
  renderGitDiffOutcome,
} from "../../commands/proxy/proxy-git-diff";
import { z } from "zod";
import path from "node:path";

import { getRgOutcome } from "../../commands/grep-search";
import {
  getReadOutcome,
  parseReadRequests,
  readUsageFailure,
  resolveReadAllowance,
} from "../../commands/read";
import { executeSafeReplaceOutcome } from "../../commands/replace";
import { getWriteOutcome } from "../../commands/write";
import {
  formatProxyOutput,
  redactSecrets,
  truncateOutput,
} from "../../commands/proxy";
import {
  formatProxyFailure,
  validateProxyRequest,
} from "../../commands/proxy/proxy-policy";
import { executeRtkCommand } from "../../commands/proxy/proxy-execution";
import {
  getListBatchOutcome,
  listContentAllowance,
  listAllowanceIncreaseHint,
  resolveListAllowance,
  RtkListingUnavailableError,
} from "../../commands/proxy/proxy-ls-batch";
import { ToolDefinition } from "../../core/config";
import { getOutcomeText } from "../../core/operation-outcome";
import type { WorkspaceContext } from "../../utils/workspace";
import { resolveRequestAllowance } from "../../core/config/allowance";
import { getTokenCount } from "../../utils/read-utils";
import {
  discoverFindBatch,
  getFindValidationFailure,
  getFindValidationText,
  getSafeFindValidationMessage,
} from "../../commands/proxy/proxy-find-batch";
import { isRtkAvailable } from "../../commands/proxy/proxy-execution";

function measureFindMcpResponse(
  text: string,
  isError: boolean,
  requestId?: string | number,
): number {
  // Direct registry calls without an SDK request ID measure the body only;
  // real stdio requests always carry the ID through bootstrap's handler seam.
  if (requestId === undefined) return getTokenCount(text);
  const response = JSON.stringify({
    jsonrpc: "2.0",
    id: requestId,
    result: { isError, content: [{ type: "text", text }] },
  });
  return getTokenCount(`${response}\n`);
}

function measureFindMcpBytes(
  text: string,
  isError: boolean,
  requestId?: string | number,
): number {
  // See measureFindMcpResponse: no-ID direct calls have no JSON-RPC envelope.
  if (requestId === undefined) return Buffer.byteLength(text, "utf8");
  const response = JSON.stringify({
    jsonrpc: "2.0",
    id: requestId,
    result: { isError, content: [{ type: "text", text }] },
  });
  return Buffer.byteLength(`${response}\n`, "utf8");
}

export interface McpToolResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
  [key: string]: unknown;
}

export type McpToolHandler = (
  args: Record<string, unknown>,
  context?: WorkspaceContext,
  requestId?: string | number,
  reportProgress?: (phase: "preparing" | "searching") => void,
  progressAllowanceTokens?: number,
) => Promise<McpToolResponse>;

export interface ToolRegistryEntry {
  schema: (params: ToolDefinition["params"]) => z.ZodObject<z.ZodRawShape>;
  handler: McpToolHandler;
}

const registry: Record<string, ToolRegistryEntry> = {
  spekta_read: {
    schema: (params) =>
      z.object({
        paths: z.array(z.string()).describe(params.paths?.description || ""),
        expectedVersion: z
          .string()
          .optional()
          .describe(
            params.expectedVersion?.description ||
              "Version from an earlier read. Requires exactly one path; a mismatch returns restart guidance without content.",
          ),
        allowance: z
          .number()
          .optional()
          .describe(
            params.allowance?.description ||
              "Optional response allowance in tokens for the whole rendered response. Positive whole number within the configured ceiling.",
          ),
        overview: z
          .boolean()
          .optional()
          .describe(
            params.overview?.description ||
              "Request a structural overview. Cannot be combined with explicit ranges.",
          ),
      }),
    handler: async (rawArgs, context, requestId) => {
      const parsed = z
        .object({
          paths: z.array(z.string()).min(1),
          allowance: z.unknown().optional(),
          expectedVersion: z.unknown().optional(),
          overview: z.boolean().optional(),
        })
        .strict()
        .safeParse(rawArgs);
      let fileRequests;
      let allowanceRaw: unknown;
      try {
        if (!parsed.success) throw new Error("Invalid read request");
        fileRequests = parseReadRequests(parsed.data.paths);
        allowanceRaw = parsed.data.allowance;
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: getOutcomeText(readUsageFailure(requestId)),
            },
          ],
        };
      }
      const resolved = resolveReadAllowance(allowanceRaw, requestId);
      if (resolved.failure)
        return {
          isError: true,
          content: [{ type: "text", text: getOutcomeText(resolved.failure) }],
        };
      const outcome = await getReadOutcome(
        fileRequests,
        false,
        context,
        requestId,
        "",
        resolved.allowance,
        parsed.success ? parsed.data.expectedVersion : undefined,
        parsed.success ? parsed.data.overview === true : false,
      );
      return {
        ...(outcome.status === "partial_result" ||
        outcome.status === "usage_error" ||
        outcome.status === "version_mismatch" ||
        outcome.status === "output_limit_exceeded" ||
        outcome.status === "policy_rejection" ||
        outcome.status === "engine_failure"
          ? { isError: true }
          : {}),
        content: [
          {
            type: "text",
            text: getOutcomeText(outcome),
          },
        ],
      };
    },
  },

  spekta_replace: {
    schema: (params) =>
      z.object({
        path: z.string().describe(params.path?.description || ""),
        blocks: z.string().describe(params.blocks?.description || ""),
      }),
    handler: async (rawArgs, context, requestId) => {
      const { path: filePath, blocks } = rawArgs as {
        path: string;
        blocks: string;
      };
      const outcome = await executeSafeReplaceOutcome(
        { path: filePath, blocks: [] },
        blocks,
        context,
        requestId,
      );
      return {
        ...(outcome.status === "policy_rejection" ||
        outcome.status === "engine_failure" ||
        outcome.status === "output_limit_exceeded"
          ? { isError: true }
          : {}),
        content: [
          {
            type: "text",
            text:
              outcome.status === "success"
                ? outcome.value.message
                : outcome.status === "partial_result"
                  ? outcome.value.message
                  : outcome.message,
          },
        ],
      };
    },
  },

  spekta_write: {
    schema: (params) =>
      z.object({
        path: z.string().describe(params.path?.description || ""),
        content: z.string().describe(params.content?.description || ""),
      }),
    handler: async (rawArgs, context, requestId) => {
      const { path: filePath, content } = rawArgs as {
        path: string;
        content: string;
      };
      const outcome = await getWriteOutcome(
        filePath,
        content,
        context,
        requestId,
      );
      return {
        ...(outcome.status === "policy_rejection" ||
        outcome.status === "engine_failure" ||
        outcome.status === "output_limit_exceeded"
          ? { isError: true }
          : {}),
        content: [
          {
            type: "text",
            text:
              outcome.status === "success"
                ? outcome.value.message
                : outcome.status === "partial_result"
                  ? outcome.value.message
                  : outcome.message,
          },
        ],
      };
    },
  },

  spekta_rg: {
    schema: (params) =>
      z.object({
        patterns: z
          .array(z.string())
          .describe(
            params.patterns?.description ||
              "Patterns to search; alternatives use OR matching.",
          ),
        paths: z
          .array(z.string())
          .optional()
          .describe(
            params.paths?.description ||
              "File and directory paths to search. Omit or pass an empty array for the workspace root.",
          ),
        globs: z
          .array(z.string())
          .optional()
          .describe(
            params.globs?.description || "Ordered ripgrep glob filters.",
          ),
        case_mode: z
          .enum(["sensitive", "insensitive", "smart"])
          .optional()
          .describe(
            params.case_mode?.description ||
              "Case matching mode; defaults to sensitive.",
          ),
        allowance: z
          .unknown()
          .optional()
          .describe(
            params.allowance?.description ||
              "Optional complete response allowance in tokens, within the configured search ceiling.",
          ),
        profile: z
          .boolean()
          .optional()
          .describe(
            "Include aggregate preparation and search timings in the final response when they fit the response allowance.",
          ),
      }),
    handler: async (
      rawArgs,
      context,
      requestId,
      reportProgress,
      progressAllowanceTokens,
    ) => {
      const outcome = await getRgOutcome(
        {
          patterns: rawArgs.patterns as string[],
          paths: (rawArgs.paths as string[] | undefined) ?? [],
          globs: (rawArgs.globs as string[] | undefined) ?? [],
          case_mode:
            (rawArgs.case_mode as
              "sensitive" | "insensitive" | "smart" | undefined) ?? "sensitive",
          allowance: rawArgs.allowance,
          profile: rawArgs.profile === true,
          onProgress: reportProgress,
          progressAllowanceTokens,
        },
        context,
        requestId,
      );
      const text =
        outcome.status === "success" || outcome.status === "partial_result"
          ? outcome.value
          : outcome.message;
      return {
        ...(outcome.status === "engine_failure" ||
        outcome.status === "policy_rejection" ||
        outcome.status === "usage_error" ||
        outcome.status === "output_limit_exceeded" ||
        outcome.status === "partial_result"
          ? { isError: true }
          : {}),
        content: [{ type: "text", text }],
      };
    },
  },

  spekta_shell: {
    schema: (params) =>
      z.object({
        command: z.string().describe(params?.command?.description || ""),
        args: z
          .array(z.string())
          .optional()
          .describe(
            params?.args?.description ||
              "Command arguments. For find, supply zero or more literal roots before supported -type/-name predicates (zero uses .); -name values are literal arguments.",
          ),
        // Let find's budget-aware handler reject malformed values. Other
        // commands retain their existing command-specific allowance checks.
        allowance: z
          .unknown()
          .optional()
          .describe(
            params?.allowance?.description ||
              "Optional response allowance in tokens for ls and find. The handler validates a positive whole number within the configured list ceiling.",
          ),
      }),
    handler: async (rawArgs, context, requestId) => {
      const { command, args, allowance } = rawArgs as {
        command: string;
        args?: string[];
        allowance?: unknown;
      };
      const cleanArgs = args ?? [];

      if (
        Object.hasOwn(rawArgs, "allowance") &&
        command !== "ls" &&
        command !== "find"
      ) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "usage_error: Allowance is supported only for ls and find.",
            },
          ],
        };
      }

      try {
        validateProxyRequest(command, cleanArgs, context);
      } catch (error: unknown) {
        if (command === "find") {
          const resolved = resolveRequestAllowance("list", allowance);
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: getFindValidationText(
                  getFindValidationFailure(
                    (text, isError) =>
                      measureFindMcpResponse(text, isError, requestId),
                    resolved.settings.ceilingTokens,
                    resolved.settings.defaultTokens,
                    "shorten a long MCP request ID if needed",
                    getSafeFindValidationMessage(error),
                  ),
                ),
              },
            ],
          };
        }
        return {
          isError: true,
          content: [{ type: "text", text: formatProxyFailure(error) }],
        };
      }
      if (command === "ls") {
        const resolvedAllowance = resolveListAllowance(allowance);
        if (resolvedAllowance.failure) {
          return {
            isError: true,
            content: [
              { type: "text", text: resolvedAllowance.failure.message },
            ],
          };
        }
        const tokenAllowance = resolvedAllowance.allowance ?? 1000;
        const outcome = await getListBatchOutcome(cleanArgs, context, {
          allowance: listContentAllowance(tokenAllowance),
          increaseHint: listAllowanceIncreaseHint(tokenAllowance),
          runLs: async (operand) => {
            const listed = await executeRtkCommand("ls", [operand], context);
            if (!listed.available) throw new RtkListingUnavailableError();
            return { stdout: listed.stdout, exitCode: listed.exitCode };
          },
        });
        if (outcome.status === "failure") {
          return {
            isError: true,
            content: [{ type: "text", text: outcome.message }],
          };
        }
        return {
          isError: outcome.status === "partial_result",
          content: [{ type: "text", text: outcome.content }],
        };
      }
      if (command === "find") {
        const resolved = resolveRequestAllowance("list", allowance);
        const settings = resolved.settings;
        const tokenAllowance =
          resolved.status === "ok"
            ? (resolved.requested ?? settings.defaultTokens)
            : settings.defaultTokens;
        if (resolved.status !== "ok") {
          const failure = getFindValidationFailure(
            (text, isError) => measureFindMcpResponse(text, isError, requestId),
            settings.ceilingTokens,
            settings.defaultTokens,
            "shorten a long MCP request ID if needed",
            resolved.status === "invalid"
              ? "usage_error: Allowance must be a positive whole number."
              : `usage_error: Allowance exceeds the configured ceiling; configured ceiling is ${settings.ceilingTokens} tokens.`,
          );
          return {
            isError: true,
            content: [{ type: "text", text: getFindValidationText(failure) }],
          };
        }
        const minimum = getFindValidationFailure(
          (text, isError) => measureFindMcpResponse(text, isError, requestId),
          settings.ceilingTokens,
          settings.defaultTokens,
          "shorten a long MCP request ID if needed",
        );
        if (tokenAllowance < minimum.tokens) {
          return {
            isError: true,
            content: [{ type: "text", text: getFindValidationText(minimum) }],
          };
        }
        const outcome = await discoverFindBatch(cleanArgs, context, {
          allowance: tokenAllowance,
          validationAllowance: settings.defaultTokens,
          maximumAllowance: settings.ceilingTokens,
          requestIdRecoveryHint: "shorten a long MCP request ID if needed",
          increaseHint:
            settings.ceilingTokens > tokenAllowance
              ? ` A larger allowance up to ${settings.ceilingTokens} tokens is supported.`
              : "",
          measure: (text, isError) =>
            measureFindMcpResponse(text, isError, requestId),
          metadataBytes: (text, isError) =>
            measureFindMcpBytes(text, isError, requestId),
          hasRtk: await isRtkAvailable(),
          backend: async (operand, predicates) => {
            const result = await executeRtkCommand(
              "find",
              [operand, ...predicates],
              context,
            );
            if (!result.available) throw new Error("RTK unavailable");
            return { stdout: result.stdout, exitCode: result.exitCode };
          },
        });
        return {
          isError: outcome.isError,
          content: [{ type: "text", text: outcome.content }],
        };
      }
      if (command === "git" && isGitHistoryPatchRequest(cleanArgs)) {
        const outcome = await executeGitHistoryPatchOutcome(cleanArgs, context);
        return {
          isError: outcome.status === "failure",
          content: [
            {
              type: "text",
              text:
                outcome.status === "failure"
                  ? outcome.message
                  : outcome.content,
            },
          ],
        };
      }
      if (
        command === "git" &&
        cleanArgs[0] === "diff" &&
        !cleanArgs.some((arg) =>
          ["--name-only", "--name-status", "--stat"].includes(arg),
        )
      ) {
        const outcome = await executeGitDiffPatchOutcome(cleanArgs, context);
        return {
          isError: outcome.status === "failure",
          content: [
            {
              type: "text",
              text:
                outcome.status === "failure"
                  ? outcome.message
                  : outcome.content,
            },
          ],
        };
      }
      let result;
      try {
        result = await executeRtkCommand(command, cleanArgs, context);
      } catch (error: unknown) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                command === "git" && cleanArgs[0] === "status"
                  ? "RTK listing failed before output could be checked."
                  : formatProxyFailure(error),
            },
          ],
        };
      }
      if (!result.available) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "The `rtk` executable was not found. Install RTK with the `rtk-ai` package, then retry.",
            },
          ],
        };
      }

      if (command === "git" && cleanArgs[0] === "status") {
        const outcome = await renderGitStatusOutcome(
          result,
          cleanArgs,
          context,
        );
        return {
          isError: outcome.status === "failure",
          content: [
            {
              type: "text",
              text:
                outcome.status === "failure"
                  ? outcome.message
                  : outcome.content,
            },
          ],
        };
      }

      if (command === "git" && cleanArgs[0] === "branch") {
        const outcome = renderGitBranchOutcome(result);
        return {
          isError: outcome.status === "failure",
          content: [
            {
              type: "text",
              text:
                outcome.status === "failure"
                  ? outcome.message
                  : outcome.content,
            },
          ],
        };
      }

      if (
        command === "git" &&
        cleanArgs[0] === "show" &&
        cleanArgs.some(
          (arg, index) =>
            index > 0 && !arg.startsWith("-") && arg.includes(":"),
        )
      ) {
        const selector = cleanArgs.find(
          (arg, index) =>
            index > 0 && !arg.startsWith("-") && arg.includes(":"),
        )!;
        const outcome = await renderGitBlobOutcome(result, selector, context);
        return {
          isError: outcome.status === "failure",
          content: [
            {
              type: "text",
              text:
                outcome.status === "failure"
                  ? formatProxyOutput("git", outcome.message, {
                      exitCode: outcome.exitCode,
                    })
                  : outcome.content,
            },
          ],
        };
      }

      if (
        command === "git" &&
        ["log", "show"].includes(cleanArgs[0]) &&
        (cleanArgs[0] === "log" ||
          cleanArgs.some((arg) =>
            ["--stat", "--name-only", "--name-status"].includes(arg),
          ))
      ) {
        const outcome = await renderGitHistoryOutcome(
          result,
          cleanArgs,
          context,
        );
        return {
          isError: outcome.status === "failure",
          content: [
            {
              type: "text",
              text:
                outcome.status === "failure"
                  ? outcome.message
                  : outcome.content,
            },
          ],
        };
      }

      if (command === "git" && cleanArgs[0] === "diff") {
        const outcome = await renderGitDiffOutcome(result, cleanArgs, context);
        return {
          isError: outcome.status === "failure",
          content: [
            {
              type: "text",
              text:
                outcome.status === "failure"
                  ? outcome.message
                  : outcome.content,
            },
          ],
        };
      }

      const rawOutput = [result.stdout, result.stderr]
        .filter(Boolean)
        .join("\n");
      const truncated = truncateOutput(rawOutput);
      const safeOutput = redactSecrets(truncated.content);

      return {
        isError: result.exitCode !== 0,
        content: [{ type: "text", text: safeOutput }],
      };
    },
  },
};

/**
 * Create handlers whose filesystem and shell operations stay inside one MCP
 * server's launch workspace.
 */
export function createToolRegistry(
  context: WorkspaceContext,
): Record<string, ToolRegistryEntry> {
  const boundContext = Object.freeze({ root: path.resolve(context.root) });
  return Object.fromEntries(
    Object.entries(registry).map(([name, implementation]) => [
      name,
      {
        schema: implementation.schema,
        handler: (
          args: Record<string, unknown>,
          _context?: WorkspaceContext,
          requestId?: string | number,
        ) => implementation.handler(args, boundContext, requestId),
      },
    ]),
  );
}

/** Unbound registry retained for callers that use MCP handlers directly. */
export const TOOL_REGISTRY = registry;
