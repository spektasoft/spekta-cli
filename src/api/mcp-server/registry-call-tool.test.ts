import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAllowanceSettings } from "../../core/config/allowance";
import { getTokenCount } from "../../utils/read-utils";
import { getMinimumGitMcpAllowance } from "../../commands/proxy/proxy-git-response-budget";
import { createToolRegistry } from "./registry";

const execution = vi.hoisted(() => ({
  isRtkAvailable: vi.fn(() => Promise.resolve(true)),
  executeRtkCommand: vi.fn(() =>
    Promise.resolve({
      available: true as const,
      stdout: "./kept.ts\n",
      stderr: "",
      exitCode: 0,
    }),
  ),
}));

vi.mock("../../commands/proxy/proxy-execution", () => execution);

const created: string[] = [];

function readToolResult(value: unknown): {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
} {
  if (typeof value !== "object" || value === null)
    throw new Error("MCP callTool returned a non-object result");
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.content) || record.content.length === 0)
    throw new Error("MCP callTool returned no content");
  const first: unknown = (record.content as unknown[])[0];
  if (
    typeof first !== "object" ||
    first === null ||
    !("type" in first) ||
    first.type !== "text" ||
    !("text" in first) ||
    typeof first.text !== "string"
  )
    throw new Error("MCP callTool returned unexpected text content");
  return {
    isError: record.isError === true,
    content: [{ type: "text", text: first.text }],
  };
}

afterEach(async () => {
  await Promise.all(created.splice(0).map((folder) => fs.remove(folder)));
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("registered spekta_shell callTool allowance validation", () => {
  it("budgets complete Git responses with the MCP request ID", async () => {
    const workspace = await fs.mkdtemp(
      path.join(os.tmpdir(), "spekta-mcp-git-envelope-"),
    );
    created.push(workspace);
    const tool = createToolRegistry({ root: workspace }).spekta_shell;
    const requestId = "git-request-0123456789abcdef";
    const envelope = (result: unknown) =>
      JSON.stringify({ jsonrpc: "2.0", id: requestId, result }) + "\n";

    const complete = await tool.handler(
      { command: "git", args: ["status", "--not-supported"], allowance: 1000 },
      undefined,
      requestId,
    );
    expect(complete.isError).toBe(true);
    expect(complete.content[0].text).toContain("spekta help git status");
    expect(getTokenCount(envelope(complete))).toBeLessThanOrEqual(1000);

    const minimum = getMinimumGitMcpAllowance(requestId);
    const rejected = await tool.handler(
      {
        command: "git",
        args: ["status", "--not-supported"],
        allowance: minimum - 1,
      },
      undefined,
      requestId,
    );
    expect(rejected.isError).toBe(true);
    expect(rejected.content[0].text).toContain("usage_error");
    expect(getTokenCount(envelope(rejected))).toBeLessThanOrEqual(
      resolveAllowanceSettings("git").defaultTokens,
    );
    expect(execution.isRtkAvailable).not.toHaveBeenCalled();
    expect(execution.executeRtkCommand).not.toHaveBeenCalled();
  });

  it("rejects long request IDs before execution with a bounded diagnostic", async () => {
    const workspace = await fs.mkdtemp(
      path.join(os.tmpdir(), "spekta-mcp-git-long-id-"),
    );
    created.push(workspace);
    const tool = createToolRegistry({ root: workspace }).spekta_shell;
    const requestId = "x".repeat(10_000);
    const result = await tool.handler(
      { command: "git", args: ["status"], allowance: 1000 },
      undefined,
      requestId,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("usage_error");
    expect(result.content[0].text).not.toBe("output_limit_exceeded");
    expect(getTokenCount(result.content[0].text)).toBeLessThanOrEqual(64);
    expect(execution.isRtkAvailable).not.toHaveBeenCalled();
    expect(execution.executeRtkCommand).not.toHaveBeenCalled();
    const responseEnvelope = JSON.parse(
      JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        result,
      }),
    ) as { id: string };
    expect(responseEnvelope.id).toBe(requestId);
  });

  it("routes wrong-type find allowance through budgeted handler and accepts a valid allowance", async () => {
    vi.stubEnv("SPEKTA_LIST_TOKEN_LIMIT", "1000");
    vi.stubEnv("SPEKTA_LIST_TOKEN_CEILING", "2000");
    const workspace = await fs.mkdtemp(
      path.join(os.tmpdir(), "spekta-mcp-find-allowance-"),
    );
    created.push(workspace);
    await fs.writeFile(path.join(workspace, "kept.ts"), "content");

    const tool = createToolRegistry({ root: workspace }).spekta_shell;
    const server = new McpServer({ name: "spekta-test", version: "1.0.0" });
    server.registerTool(
      "spekta_shell",
      {
        inputSchema: tool.schema({
          command: { description: "" },
          args: { description: "" },
          allowance: { description: "" },
        }).shape,
      },
      (args, extra) => tool.handler(args, undefined, extra.requestId),
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const sentRequests: unknown[] = [];
    const sentResponses: unknown[] = [];
    const clientSend = clientTransport.send.bind(clientTransport);
    clientTransport.send = async (message, options) => {
      if ("method" in message && message.method === "tools/call") {
        sentRequests.push(message);
      }
      return clientSend(message, options);
    };
    const serverSend = serverTransport.send.bind(serverTransport);
    serverTransport.send = async (message, options) => {
      if ("id" in message && "result" in message) {
        sentResponses.push(message);
      }
      return serverSend(message, options);
    };

    const client = new Client({ name: "spekta-test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const rejected = readToolResult(
        await client.callTool({
          name: "spekta_shell",
          arguments: {
            command: "find",
            args: ["."],
            allowance: "not-a-number",
          },
        }),
      );
      const request = sentRequests.at(-1) as { id: unknown };
      const response = sentResponses.at(-1) as {
        id: unknown;
        result: {
          isError?: boolean;
          content: Array<{ type: string; text: string }>;
        };
      };
      const responseId = response.id;
      const result = response.result;
      const responseText = result.content[0].text;
      const completeResponse = `${JSON.stringify(response)}\n`;
      const completeTokens = getTokenCount(completeResponse);

      expect(typeof request.id).toBe("number");
      expect(responseId).toBe(request.id);
      expect(rejected.isError).toBe(true);
      expect(result.isError).toBe(true);
      expect(responseText).toBe(
        "usage_error: Allowance must be a positive whole number.",
      );
      expect(responseText).not.toContain("not-a-number");
      expect(completeTokens).toBeLessThanOrEqual(
        resolveAllowanceSettings("list").defaultTokens,
      );
      expect(execution.isRtkAvailable).not.toHaveBeenCalled();
      expect(execution.executeRtkCommand).not.toHaveBeenCalled();
      console.log("SDK callTool wrong-type allowance boundary", {
        requestId: responseId,
        status: "usage_error",
        defaultAllowance: resolveAllowanceSettings("list").defaultTokens,
        completeTokens,
        response: completeResponse,
        rtkProbes: 0,
        enumerations: 0,
      });

      const accepted = readToolResult(
        await client.callTool({
          name: "spekta_shell",
          arguments: { command: "find", args: ["."], allowance: 500 },
        }),
      );
      expect(accepted.isError).toBe(false);
      expect(accepted.content[0].type).toBe("text");
      expect(accepted.content[0].text).toContain("Batch: success");
      expect(execution.isRtkAvailable).toHaveBeenCalledOnce();
      expect(execution.executeRtkCommand).toHaveBeenCalledOnce();
      expect(execution.executeRtkCommand).toHaveBeenCalledWith("find", ["."], {
        root: workspace,
      });

      const rejectedLs = readToolResult(
        await client.callTool({
          name: "spekta_shell",
          arguments: { command: "ls", args: ["."], allowance: "bad" },
        }),
      );
      expect(rejectedLs.isError).toBe(true);
      expect(rejectedLs.content[0].type).toBe("text");
      expect(rejectedLs.content[0].text).toContain("Allowance");

      const rejectedGit = readToolResult(
        await client.callTool({
          name: "spekta_shell",
          arguments: { command: "git", args: ["status"], allowance: "bad" },
        }),
      );
      expect(rejectedGit.isError).toBe(true);
      expect(rejectedGit.content[0].type).toBe("text");
      expect(rejectedGit.content[0].text).toBe(
        "usage_error: Allowance must be a positive whole number. Use spekta help git.",
      );
      expect(execution.executeRtkCommand).toHaveBeenCalledOnce();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
