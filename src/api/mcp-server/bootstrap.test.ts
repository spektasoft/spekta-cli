import { beforeEach, describe, expect, it, vi } from "vitest";

const registerTool = vi.fn();
const connect = vi.fn();
const serverInstances: Array<{
  registerTool: typeof registerTool;
  connect: typeof connect;
}> = [];

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

vi.mock("./registry", () => ({
  TOOL_REGISTRY: {
    spekta_grep: {
      schema: () => ({
        shape: {},
      }),
      handler: vi.fn(),
    },
  },
}));

vi.mock("./validate", () => ({
  validateToolDefinitions: vi.fn(),
}));

import {
  bootstrap as initializeProject,
  loadToolDefinitions,
} from "../../core/config";
import { validateToolDefinitions } from "./validate";
import { runMcpServer } from "./bootstrap";

beforeEach(() => {
  vi.clearAllMocks();
  serverInstances.length = 0;
  registerTool.mockReset();
  connect.mockReset();

  vi.mocked(initializeProject).mockResolvedValue(undefined);
  vi.mocked(loadToolDefinitions).mockResolvedValue([]);
  connect.mockResolvedValue(undefined);
});

describe("runMcpServer", () => {
  it("initializes configuration, validates tools, registers tools, and connects transport", async () => {
    vi.mocked(loadToolDefinitions).mockResolvedValue([
      {
        name: "spekta_grep",
        description: "Search",
        params: {},
      },
    ]);

    await runMcpServer();

    expect(initializeProject).toHaveBeenCalledOnce();
    expect(validateToolDefinitions).toHaveBeenCalledWith([
      {
        name: "spekta_grep",
        description: "Search",
        params: {},
      },
    ]);
    expect(registerTool).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledOnce();
  });

  it("skips duplicate tool names", async () => {
    vi.mocked(loadToolDefinitions).mockResolvedValue([
      { name: "spekta_grep", description: "Search", params: {} },
      { name: "spekta_grep", description: "Search again", params: {} },
    ]);

    await runMcpServer();

    expect(registerTool).toHaveBeenCalledOnce();
  });

  it("skips tools without implementations", async () => {
    vi.mocked(loadToolDefinitions).mockResolvedValue([
      { name: "unknown_tool", description: "Unknown", params: {} },
    ]);

    await runMcpServer();

    expect(registerTool).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledOnce();
  });

  it("returns an MCP error response when a handler throws", async () => {
    const implementation = (await import("./registry")).TOOL_REGISTRY
      .spekta_grep;

    vi.mocked(implementation.handler).mockRejectedValueOnce(new Error("boom"));

    vi.mocked(loadToolDefinitions).mockResolvedValue([
      { name: "spekta_grep", description: "Search", params: {} },
    ]);

    await runMcpServer();

    const handler = registerTool.mock.calls[0][3];
    await expect(handler({})).resolves.toEqual({
      isError: true,
      content: [{ type: "text", text: "Execution failed: Error: boom" }],
    });
  });
});
