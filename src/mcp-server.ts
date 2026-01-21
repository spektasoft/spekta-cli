import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getReadContent } from "./commands/read";
import { parseFilePathWithRange } from "./utils/read-utils";
import { bootstrap } from "./config";

export async function runMcpServer() {
  await bootstrap();

  const server = new Server(
    {
      name: "spekta",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "read_files",
        description:
          "Read one or multiple files with optional range support. Ranges use [start,end] syntax. Example: 'src/main.ts[10,50]'",
        inputSchema: {
          type: "object",
          properties: {
            paths: {
              type: "array",
              items: { type: "string" },
              description: "List of file paths with optional range brackets",
            },
          },
          required: ["paths"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "read_files") {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const paths = request.params.arguments?.paths as string[];
    if (!paths || !Array.isArray(paths)) {
      throw new Error("Invalid arguments: paths must be an array of strings");
    }

    try {
      const fileRequests = paths.map((p) => parseFilePathWithRange(p));
      const content = await getReadContent(fileRequests);

      return {
        content: [{ type: "text", text: content }],
      };
    } catch (error: any) {
      // Log security violations or missing files to stderr for host debugging
      process.stderr.write(`MCP Read Tool Error: ${error.message}\n`);
      return {
        content: [{ type: "text", text: `Access Error: ${error.message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("Spekta MCP Server running on stdio\n");
}
