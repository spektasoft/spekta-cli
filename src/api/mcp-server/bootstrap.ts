import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { bootstrap as initializeProject } from "../../core/config";
import { loadToolDefinitions } from "../../core/config";
import { Logger } from "../../utils/logger";
import { TOOL_REGISTRY } from "./registry";
import { validateToolDefinitions } from "./validate";

export async function runMcpServer() {
  await initializeProject();

  const server = new McpServer({
    name: "spekta-mcp-server",
    version: "1.0.0",
  });

  const tools = await loadToolDefinitions();
  validateToolDefinitions(tools);

  const registeredNames = new Set<string>();

  for (const tool of tools) {
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
        tool.description,
        implementation.schema(tool.params).shape,
        async (args) => {
          try {
            return await implementation.handler(args);
          } catch (error: unknown) {
            Logger.error(`MCP Tool Execution Error [${tool.name}]:`, error);
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `Execution failed: ${String(error)}`,
                },
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
