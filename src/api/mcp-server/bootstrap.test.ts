import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { registerTool, connect, toolHandler, serverInstances } = vi.hoisted(
  () => {
    const registerTool = vi.fn();
    const connect = vi.fn();
    return {
      registerTool,
      connect,
      toolHandler: vi.fn(),
      serverInstances: [] as Array<{
        registerTool: typeof registerTool;
        connect: typeof connect;
      }>,
    };
  },
);
const registryEntry = {
  schema: () => z.object({}),
  handler: toolHandler,
};

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: vi.fn(function () {
    const instance = { registerTool, connect };
    serverInstances.push(instance);
    return instance;
  }),
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn(function () {
    return { kind: "stdio" };
  }),
}));

vi.mock("../../core/config", () => ({
  bootstrap: vi.fn(),
  loadToolDefinitions: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  Logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../utils/workspace", () => ({
  resolveWorkspace: vi.fn(),
}));

vi.mock("./registry", async () => {
  const { z } = await import("zod");
  const entry = { schema: () => z.object({}), handler: toolHandler };
  return {
    createToolRegistry: vi.fn(() => ({ spekta_grep: entry })),
    TOOL_REGISTRY: { spekta_grep: entry },
  };
});

vi.mock("./validate", () => ({
  validateToolDefinitions: vi.fn(),
}));

import {
  bootstrap as initializeProject,
  loadToolDefinitions,
} from "../../core/config";
import { validateToolDefinitions } from "./validate";
import { createToolRegistry } from "./registry";
import { resolveWorkspace } from "../../utils/workspace";
import { runMcpServer } from "./bootstrap";

beforeEach(() => {
  vi.clearAllMocks();
  serverInstances.length = 0;
  registerTool.mockReset();
  connect.mockReset();

  vi.mocked(initializeProject).mockResolvedValue(undefined);
  vi.mocked(loadToolDefinitions).mockResolvedValue([]);
  vi.mocked(resolveWorkspace).mockResolvedValue({
    root: "/launch",
    canonicalRoot: "/canonical-launch",
  });
  vi.mocked(createToolRegistry).mockReturnValue({
    spekta_grep: registryEntry,
  });
  toolHandler.mockReset();
  connect.mockResolvedValue(undefined);
});

describe("runMcpServer", () => {
  it("initializes configuration, validates tools, registers tools, and connects transport", async () => {
    vi.mocked(loadToolDefinitions).mockResolvedValue([
      {
        name: "spekta_grep",
        description: "Search",
        params: {},
        xml_example: "<spekta_grep></spekta_grep>",
      },
    ]);

    await runMcpServer();

    expect(initializeProject).toHaveBeenCalledOnce();
    expect(initializeProject).toHaveBeenCalledWith({
      writeUserHome: false,
      workspaceRoot: process.cwd(),
    });
    expect(validateToolDefinitions).toHaveBeenCalledWith([
      {
        name: "spekta_grep",
        description: "Search",
        params: {},
        xml_example: "<spekta_grep></spekta_grep>",
      },
    ]);
    expect(registerTool).toHaveBeenCalledOnce();
    expect(registerTool).toHaveBeenCalledWith(
      "spekta_grep",
      {
        description: "Search",
        inputSchema: {},
      },
      expect.any(Function),
    );
    expect(connect).toHaveBeenCalledOnce();
    const boundContext = vi.mocked(createToolRegistry).mock.calls[0][0];
    expect(boundContext).toEqual({ root: "/canonical-launch" });
    expect(Object.isFrozen(boundContext)).toBe(true);
  });

  it("passes the JSON-RPC request ID to the tool handler", async () => {
    vi.mocked(loadToolDefinitions).mockResolvedValue([
      {
        name: "spekta_grep",
        description: "Search",
        params: {},
        xml_example: "<spekta_grep></spekta_grep>",
      },
    ]);
    await runMcpServer();

    const callback = registerTool.mock.calls[0][2] as (
      args: Record<string, unknown>,
      extra: { requestId: string | number },
    ) => Promise<unknown>;
    const requestId = `request-${"x".repeat(128)}`;
    await callback({ pattern: "needle" }, { requestId });
    expect(toolHandler).toHaveBeenCalledWith(
      { pattern: "needle" },
      undefined,
      requestId,
    );
  });

  it("anchors configuration to launch cwd when cwd changes during workspace validation", async () => {
    const cwd = vi.spyOn(process, "cwd");
    cwd.mockReturnValue("/launch-before-await");
    const pendingWorkspace = Promise.withResolvers<{
      root: string;
      canonicalRoot: string;
    }>();
    vi.mocked(resolveWorkspace).mockReturnValueOnce(pendingWorkspace.promise);
    const startup = runMcpServer();
    expect(initializeProject).not.toHaveBeenCalled();
    cwd.mockReturnValue("/changed");
    pendingWorkspace.resolve({
      root: "/launch-before-await",
      canonicalRoot: "/canonical-launch",
    });
    await startup;
    expect(resolveWorkspace).toHaveBeenCalledWith({
      root: "/launch-before-await",
    });
    expect(initializeProject).toHaveBeenCalledWith({
      writeUserHome: false,
      workspaceRoot: "/launch-before-await",
    });
    cwd.mockRestore();
  });

  it("aborts invalid workspaces before initializing, registering, or connecting", async () => {
    vi.mocked(resolveWorkspace).mockRejectedValueOnce(
      new Error("invalid launch workspace"),
    );
    await expect(runMcpServer()).rejects.toThrow("invalid launch workspace");
    expect(initializeProject).not.toHaveBeenCalled();
    expect(registerTool).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(createToolRegistry).not.toHaveBeenCalled();
  });

  it("skips duplicate tool names", async () => {
    vi.mocked(loadToolDefinitions).mockResolvedValue([
      {
        name: "spekta_grep",
        description: "Search",
        params: {},
        xml_example: "<spekta_grep></spekta_grep>",
      },
      {
        name: "spekta_grep",
        description: "Search again",
        params: {},
        xml_example: "<spekta_grep></spekta_grep>",
      },
    ]);

    await runMcpServer();

    expect(registerTool).toHaveBeenCalledOnce();
  });

  it("skips tools without implementations", async () => {
    vi.mocked(loadToolDefinitions).mockResolvedValue([
      {
        name: "unknown_tool",
        description: "Unknown",
        params: {},
        xml_example: "<unknown_tool></unknown_tool>",
      },
    ]);

    await runMcpServer();

    expect(registerTool).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledOnce();
  });

  it("returns an MCP error response when a handler throws", async () => {
    toolHandler.mockRejectedValueOnce(new Error("boom"));

    vi.mocked(loadToolDefinitions).mockResolvedValue([
      {
        name: "spekta_grep",
        description: "Search",
        params: {},
        xml_example: "<spekta_grep></spekta_grep>",
      },
    ]);

    await runMcpServer();

    const handler = registerTool.mock.calls[0][2] as (
      args: Record<string, unknown>,
    ) => Promise<unknown>;
    await expect(handler({})).resolves.toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "Operation failed. Check workspace policy and retry with a narrower request.",
        },
      ],
    });
    toolHandler.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
    });
    await expect(handler({})).resolves.toEqual({
      content: [{ type: "text", text: "ok" }],
    });
  });

  it("continues registering tools after a registration exception", async () => {
    const grep = {
      name: "spekta_grep",
      description: "Search",
      params: {},
      xml_example: "<spekta_grep></spekta_grep>",
    };
    const read = { ...grep, name: "spekta_read" };
    vi.mocked(loadToolDefinitions).mockResolvedValue([grep, read]);
    vi.mocked(createToolRegistry).mockReturnValue({
      spekta_grep: registryEntry,
      spekta_read: registryEntry,
    });
    registerTool.mockImplementationOnce(() => {
      throw new Error("registration failed");
    });

    await runMcpServer();

    expect(registerTool).toHaveBeenCalledTimes(2);
    expect(registerTool.mock.calls[1][0]).toBe("spekta_read");
    expect(connect).toHaveBeenCalledOnce();
  });
});
