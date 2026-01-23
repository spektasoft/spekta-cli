import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "fs-extra";
import { z } from "zod";
import { getReadContent } from "./commands/read";
import { getReplaceContent } from "./commands/replace";
import { getWriteContent } from "./commands/write";
import { bootstrap } from "./config";
import { Logger } from "./utils/logger";
import { parseFilePathWithRange } from "./utils/read-utils";

export async function runMcpServer() {
  await bootstrap();

  const server = new McpServer({
    name: "spekta-mcp-server",
    version: "1.0.0",
  });

  server.registerTool(
    "read_files",
    {
      description:
        "Read one or multiple files with optional range support, always use relative path. Ranges use [start,end] syntax. Example: 'src/main.ts[10,50]'",
      inputSchema: {
        paths: z.array(z.string()),
      },
    },
    async ({ paths }) => {
      try {
        const fileRequests = paths.map((p) => parseFilePathWithRange(p));
        const content = await getReadContent(fileRequests);
        return {
          content: [{ type: "text", text: content }],
        };
      } catch (error: any) {
        // Log security violations or missing files to stderr for host debugging
        Logger.error(`MCP Read Tool Error: ${error.message}`);
        return {
          content: [{ type: "text", text: `Access Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "replace",
    {
      description: "Replace code in a file.",
      inputSchema: {
        path: z.string().describe("The relative path to the file"),
        blocks: z
          .string()
          .describe(
            "SEARCH/REPLACE blocks (<<<<<<< SEARCH\n{old_string}\n=======\n{new_string}\n>>>>>>> REPLACE). Provide significant context for precise targeting.",
          ),
      },
    },
    async ({ path, blocks }) => {
      try {
        const request = { path, blocks: [] };
        const { content, message } = await getReplaceContent(request, blocks);

        await fs.writeFile(path, content, "utf-8");

        return {
          content: [{ type: "text", text: message }],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            { type: "text", text: `Replacement failed: ${error.message}` },
          ],
        };
      }
    },
  );

  server.registerTool(
    "write_file",
    {
      description:
        "Create a new file with the provided full content. Fails if the file already exists. Path must be relative. Only for new files – use replace for modifications.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Relative path to the new file (e.g. src/utils/new-helper.ts)",
          ),
        content: z.string().describe("Full content to write to the file"),
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
          content: [{ type: "text", text: `Write failed: ${error.message}` }],
        };
      }
    },
  );

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
