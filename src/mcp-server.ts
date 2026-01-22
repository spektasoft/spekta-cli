import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "fs-extra";
import { z } from "zod";
import { getReadContent } from "./commands/read";
import { getReplaceContent } from "./commands/replace";
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
      description:
        "Replace code in a file using SEARCH/REPLACE blocks. File must be git-tracked. " +
        "Format: path, then SEARCH/REPLACE block(s). " +
        "Example: 'src/file.ts' with blocks in content parameter.",
      inputSchema: {
        path: z.string().describe("The path to the file to modify."),
        blocks: z
          .string()
          .describe(
            "SEARCH/REPLACE blocks. Format:\n" +
              "<<<<<<< SEARCH\n[exact code to find]\n=======\n[replacement code]\n>>>>>>> REPLACE\n\n" +
              "Provide significant context around the change to ensure precise targeting.",
          ),
      },
    },
    async ({ path: filePath, blocks }) => {
      try {
        // Dynamic imports removed here

        const request = {
          path: filePath,
          blocks: [], // Will be processed by getReplaceContent
        };

        const result = await getReplaceContent(request, blocks);

        // Write the updated content
        // fs is now available via static import
        await fs.writeFile(request.path, result.content, "utf-8");

        return {
          content: [
            {
              type: "text",
              text: `Successfully applied ${result.appliedCount} replacement(s) to ${request.path}`,
            },
          ],
        };
      } catch (error: any) {
        Logger.error(`MCP Replace Tool Error: ${error.message}`);
        return {
          content: [
            {
              type: "text",
              text: `Replace Error: ${error.message}`,
            },
          ],
          isError: true,
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
