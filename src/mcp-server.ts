import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getReadContent } from "./commands/read";
import { executeSafeReplace } from "./commands/replace";
import { getWriteContent } from "./commands/write";
import { bootstrap, loadToolDefinitions, ToolDefinition } from "./config";
import { Logger } from "./utils/logger";
import { parseFilePathWithRange } from "./utils/read-utils";

/**
 * Validates that all tools defined in YAML have corresponding logic
 * and that parameters are correctly documented.
 */
function validateToolDefinitions(tools: ToolDefinition[]) {
  for (const tool of tools) {
    const implementation = TOOL_REGISTRY[tool.name];
    if (!implementation) {
      Logger.warn(
        `Configuration Mismatch: Tool '${tool.name}' is defined in YAML but has no implementation in TOOL_REGISTRY.`,
      );
      continue;
    }

    // Identify parameters defined in YAML that might be missing descriptions
    const paramEntries = Object.entries(tool.params);
    for (const [key, value] of paramEntries) {
      if (!value.description || value.description.trim() === "") {
        Logger.warn(
          `Documentation Gap: Parameter '${key}' for tool '${tool.name}' lacks a description in YAML.`,
        );
      }
    }
  }
}

/**
 * Standard response format for MCP Tool handlers.
 */
interface McpToolResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Registry defining the static schema and handler for each tool.
 * Descriptions are injected dynamically from YAML definitions.
 */
const TOOL_REGISTRY: Record<
  string,
  {
    schema: (params: ToolDefinition["params"]) => z.ZodObject<any>;
    handler: (args: any) => Promise<McpToolResponse>;
  }
> = {
  spekta_read: {
    schema: (params) =>
      z.object({
        paths: z.array(z.string()).describe(params.paths?.description || ""),
      }),
    handler: async ({ paths }) => {
      const fileRequests = paths.map((p: string) => parseFilePathWithRange(p));
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
    handler: async ({ path: filePath, blocks }) => {
      // blocks is passed as a raw string to executeSafeReplace which parses it
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
    handler: async ({ path: filePath, content }) => {
      const result = await getWriteContent(filePath, content);
      return {
        isError: !result.success,
        content: [{ type: "text", text: result.message }],
      };
    },
  },
};

export async function runMcpServer() {
  await bootstrap();
  const server = new McpServer({ name: "spekta-mcp-server", version: "1.0.0" });
  const tools = await loadToolDefinitions();
  validateToolDefinitions(tools);

  // Track registered tool names to prevent duplicates
  const registeredNames = new Set<string>();

  for (const tool of tools) {
    // Check for duplicate tool names before registration
    if (registeredNames.has(tool.name)) {
      Logger.error(`Duplicate tool name detected: ${tool.name}`);
      continue;
    }

    const implementation = TOOL_REGISTRY[tool.name];
    if (!implementation) {
      Logger.warn(`No implementation found for tool: ${tool.name}`);
      continue;
    }

    try {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: implementation.schema(tool.params).shape,
        },
        // @ts-ignore
        async (args: Record<string, unknown>) => {
          try {
            return await implementation.handler(args);
          } catch (error: unknown) {
            Logger.error(`MCP Tool Execution Error [${tool.name}]:`, error);
            return {
              isError: true,
              content: [
                { type: "text", text: `Execution failed: ${String(error)}` },
              ],
            };
          }
        },
      );
      registeredNames.add(tool.name);
    } catch (err: unknown) {
      Logger.error(`Failed to register tool ${tool.name}:`, err);
    }
  }

  const transport = new StdioServerTransport();
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
  await server.connect(transport);
}
