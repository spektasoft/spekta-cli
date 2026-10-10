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
import { getReadOutcome } from "../../commands/read";
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
import { renderDiscoveryOutcome } from "../../commands/proxy/proxy-ls-render";
import { ToolDefinition } from "../../core/config";
import { getOutcomeText } from "../../core/operation-outcome";
import { parseFilePathWithRange } from "../../utils/read-utils";
import type { WorkspaceContext } from "../../utils/workspace";

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
      }),
    handler: async (rawArgs, context, requestId) => {
      const { paths } = rawArgs as { paths: string[] };
      const fileRequests = paths.map((p) => parseFilePathWithRange(p));
      const outcome = await getReadOutcome(
        fileRequests,
        false,
        context,
        requestId,
      );
      return {
        ...(outcome.status === "output_limit_exceeded" ||
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
      }),
    handler: async (rawArgs, context, requestId) => {
      const outcome = await getRgOutcome(
        {
          patterns: rawArgs.patterns as string[],
          paths: (rawArgs.paths as string[] | undefined) ?? [],
          globs: (rawArgs.globs as string[] | undefined) ?? [],
          case_mode:
            (rawArgs.case_mode as
              "sensitive" | "insensitive" | "smart" | undefined) ?? "sensitive",
        },
        context,
        requestId,
      );
      const text =
        outcome.status === "success" ? outcome.value : outcome.message;
      return {
        ...(outcome.status === "engine_failure" ||
        outcome.status === "policy_rejection"
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
          .describe(params?.args?.description || ""),
      }),
    handler: async (rawArgs, context) => {
      const { command, args } = rawArgs as {
        command: string;
        args?: string[];
      };
      const cleanArgs = args ?? [];

      try {
        validateProxyRequest(command, cleanArgs, context);
      } catch (error: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: formatProxyFailure(error) }],
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
                (command === "git" && cleanArgs[0] === "status") ||
                command === "ls" ||
                command === "find"
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

      if (command === "ls" || command === "find") {
        const outcome = await renderDiscoveryOutcome(
          result,
          cleanArgs[0]?.startsWith("-") ? "." : cleanArgs[0],
          context,
          command,
        );
        return outcome.status === "failure"
          ? {
              isError: true,
              content: [{ type: "text", text: outcome.message }],
            }
          : {
              isError: false,
              content: [{ type: "text", text: outcome.content }],
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
