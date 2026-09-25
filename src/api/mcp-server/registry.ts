import { z } from "zod";

import { getGrepContent } from "../../commands/grep-search";
import { getReadContent } from "../../commands/read";
import { executeSafeReplace } from "../../commands/replace";
import { getWriteContent } from "../../commands/write";
import {
  isCommandSafe,
  redactSecrets,
  truncateOutput,
  validateCommandArguments,
} from "../../commands/proxy";
import { executeRtkCommand } from "../../commands/proxy-execution";
import { ToolDefinition } from "../../core/config";
import { parseFilePathWithRange } from "../../utils/read-utils";

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
) => Promise<McpToolResponse>;

export interface ToolRegistryEntry {
  schema: (params: ToolDefinition["params"]) => z.ZodObject<z.ZodRawShape>;
  handler: McpToolHandler;
}

export const TOOL_REGISTRY: Record<string, ToolRegistryEntry> = {
  spekta_read: {
    schema: (params) =>
      z.object({
        paths: z.array(z.string()).describe(params.paths?.description || ""),
      }),
    handler: async (rawArgs) => {
      const { paths } = rawArgs as { paths: string[] };
      const fileRequests = paths.map((p) => parseFilePathWithRange(p));
      const content = await getReadContent(fileRequests);
      return { content: [{ type: "text", text: content }] };
    },
  },

  spekta_replace: {
    schema: (params) =>
      z.object({
        path: z.string().describe(params.path?.description || ""),
        blocks: z.string().describe(params.blocks?.description || ""),
      }),
    handler: async (rawArgs) => {
      const { path: filePath, blocks } = rawArgs as {
        path: string;
        blocks: string;
      };
      const { message } = await executeSafeReplace(
        { path: filePath, blocks: [] },
        blocks,
      );
      return { content: [{ type: "text", text: message }] };
    },
  },

  spekta_write: {
    schema: (params) =>
      z.object({
        path: z.string().describe(params.path?.description || ""),
        content: z.string().describe(params.content?.description || ""),
      }),
    handler: async (rawArgs) => {
      const { path: filePath, content } = rawArgs as {
        path: string;
        content: string;
      };
      const result = await getWriteContent(filePath, content);
      return {
        isError: !result.success,
        content: [{ type: "text", text: result.message }],
      };
    },
  },

  spekta_grep: {
    schema: (params) =>
      z.object({
        pattern: z.string().describe(params.pattern?.description || ""),
        path: z
          .string()
          .optional()
          .describe(params.path?.description || ""),
        globs: z
          .string()
          .optional()
          .describe(params.globs?.description || ""),
        case_insensitive: z
          .boolean()
          .optional()
          .describe(params.case_insensitive?.description || ""),
      }),
    handler: async (rawArgs) => {
      const args = rawArgs as unknown as Parameters<typeof getGrepContent>[0];
      const result = await getGrepContent(args);
      return { content: [{ type: "text", text: result }] };
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
    handler: async (rawArgs) => {
      const { command, args } = rawArgs as {
        command: string;
        args?: string[];
      };
      const cleanArgs = args ?? [];

      if (!isCommandSafe(command, cleanArgs)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Execution refused: '${command}' is not on the read-only allow-list.`,
            },
          ],
        };
      }

      validateCommandArguments(cleanArgs);
      const result = await executeRtkCommand(command, cleanArgs);

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
