import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getReadContent } from "./commands/read";
import { executeSafeReplace } from "./commands/replace";
import { getWriteContent } from "./commands/write";
import { bootstrap, loadToolDefinitions, ToolDefinition } from "./config";
import { Logger } from "./utils/logger";
import { parseFilePathWithRange } from "./utils/read-utils";

export async function runMcpServer() {
  await bootstrap();

  const server = new McpServer({
    name: "spekta-mcp-server",
    version: "1.0.0",
  });

  // Hardcoded type-safe schemas with dynamic descriptions injected at registration
  const buildToolSchemas = (tool: ToolDefinition) => {
    switch (tool.name) {
      case "read":
        return {
          paths: z
            .array(z.string())
            .describe(tool.params.paths?.description || ""),
        };
      case "replace":
        return {
          path: z.string().describe(tool.params.path?.description || ""),
          blocks: z.string().describe(tool.params.blocks?.description || ""),
        };
      case "write":
        return {
          path: z.string().describe(tool.params.path?.description || ""),
          content: z.string().describe(tool.params.content?.description || ""),
        };
      default:
        throw new Error(`Unknown tool: ${tool.name}`);
    }
  };

  const tools = await loadToolDefinitions();

  for (const tool of tools) {
    try {
      const schema = buildToolSchemas(tool);

      switch (tool.name) {
        case "read":
          server.registerTool(
            tool.name,
            {
              description: tool.description,
              inputSchema: {
                paths: z
                  .array(z.string())
                  .describe(tool.params.paths?.description || ""),
              },
            },
            async ({ paths }) => {
              try {
                const fileRequests = paths.map((p) =>
                  parseFilePathWithRange(p),
                );
                const content = await getReadContent(fileRequests);
                return {
                  content: [{ type: "text", text: content }],
                };
              } catch (error: any) {
                Logger.error(`MCP Read Tool Error: ${error.message}`);
                return {
                  content: [
                    { type: "text", text: `Access Error: ${error.message}` },
                  ],
                  isError: true,
                };
              }
            },
          );
          break;

        case "replace":
          server.registerTool(
            "replace",
            {
              description: tool.description,
              inputSchema: {
                path: z.string().describe(tool.params.path?.description || ""),
                blocks: z
                  .string()
                  .describe(tool.params.blocks?.description || ""),
              },
            },
            async ({ path: filePath, blocks }) => {
              try {
                const { message } = await executeSafeReplace(
                  { path: filePath, blocks: [] },
                  blocks,
                );
                return {
                  content: [{ type: "text", text: message }],
                };
              } catch (error: any) {
                return {
                  isError: true,
                  content: [
                    {
                      type: "text",
                      text: `Replacement failed: ${error.message}`,
                    },
                  ],
                };
              }
            },
          );
          break;

        case "write":
          server.registerTool(
            tool.name,
            {
              description: tool.description,
              inputSchema: {
                path: z.string().describe(tool.params.path?.description || ""),
                content: z
                  .string()
                  .describe(tool.params.content?.description || ""),
              },
            },
            async ({ path: filePath, content }) => {
              try {
                const result = await getWriteContent(filePath, content);
                if (result.success) {
                  return {
                    content: [{ type: "text", text: result.message }],
                  };
                } else {
                  return {
                    isError: true,
                    content: [{ type: "text", text: result.message }],
                  };
                }
              } catch (error: any) {
                Logger.error(`MCP Write Tool Error: ${error.message}`);
                return {
                  isError: true,
                  content: [
                    { type: "text", text: `Write failed: ${error.message}` },
                  ],
                };
              }
            },
          );
          break;
      }
    } catch (err: any) {
      Logger.warn(`Skipping tool ${tool.name}: ${err.message}`);
    }
  }

  const transport = new StdioServerTransport();

  const cleanup = async () => {
    Logger.info("Shutting down MCP server...");
    // McpServer handles internal cleanup via transport closure
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await server.connect(transport);
  Logger.info("Spekta MCP Server running on stdio");
}
