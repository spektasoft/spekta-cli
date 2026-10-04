import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { bootstrap as initializeProject } from "../../core/config";
import { loadToolDefinitions } from "../../core/config";
import { Logger } from "../../utils/logger";
import { createToolRegistry } from "./registry";
import { validateToolDefinitions } from "./validate";
import { resolveWorkspace } from "../../utils/workspace";

export async function runMcpServer() {
  // Capture the launch directory before any await; other servers or callers
  // may change process.cwd() while this server is initializing.
  const startupCwd = process.cwd();
  const resolvedWorkspace = await resolveWorkspace({ root: startupCwd });
  const workspace = Object.freeze({ root: resolvedWorkspace.canonicalRoot });

  await initializeProject({ writeUserHome: false, workspaceRoot: startupCwd });

  const server = new McpServer({
    name: "spekta-mcp-server",
    version: "1.0.0",
  });

  const tools = await loadToolDefinitions();
  validateToolDefinitions(tools);
  const registry = createToolRegistry(workspace);

  const registeredNames = new Set<string>();

  for (const tool of tools) {
    if (registeredNames.has(tool.name)) {
      Logger.error(`Duplicate tool name detected: ${tool.name}`);
      continue;
    }

    const implementation = registry[tool.name];

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
        async (args: Record<string, unknown>, extra) => {
          try {
            return await implementation.handler(
              args,
              undefined,
              extra?.requestId,
            );
          } catch {
            // Exception messages can contain denied paths, file content, or
            // child stderr. Keep diagnostics useful without forwarding them.
            Logger.error(`MCP tool ${tool.name} failed.`);
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: "Operation failed. Check workspace policy and retry with a narrower request.",
                },
              ],
            };
          }
        },
      );

      registeredNames.add(tool.name);
    } catch {
      Logger.error(`Failed to register MCP tool ${tool.name}.`);
    }
  }

  const transport = new StdioServerTransport();

  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));

  await server.connect(transport);
}
