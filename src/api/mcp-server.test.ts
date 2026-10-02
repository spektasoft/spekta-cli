import { beforeEach, describe, it, expectTypeOf, vi, expect } from "vitest";
import { McpToolResponse, TOOL_REGISTRY } from "./mcp-server/registry";
import { getGrepContent } from "../commands/grep-search";
import { getWriteContent } from "../commands/write";
import { executeRtkCommand } from "../commands/proxy/proxy-execution";
import { getTokenCount } from "../utils/read-utils";

vi.mock("../commands/read", () => ({ getReadContent: vi.fn() }));
vi.mock("../commands/replace", () => ({ executeSafeReplace: vi.fn() }));
vi.mock("../commands/write", () => ({ getWriteContent: vi.fn() }));
vi.mock("../commands/grep-search", () => ({ getGrepContent: vi.fn() }));
vi.mock("../commands/proxy/proxy-execution", () => ({
  executeRtkCommand: vi.fn(),
}));
vi.mock("../core/config", () => ({
  bootstrap: vi.fn(),
  loadToolDefinitions: vi.fn().mockResolvedValue([]),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// Re-defining the structure expected by the SDK based on the error message
// (The SDK expects a result that allows string indexing)
type SdkExpectedResult = {
  content: Array<unknown>;
  isError?: boolean;
  [x: string]: unknown;
};

describe("McpToolResponse Compatibility", () => {
  it("should be assignable to the SDK expected generic shape", () => {
    const response: McpToolResponse = {
      content: [{ type: "text", text: "hello" }],
      isError: false,
      extraField: "allowed",
    };

    const sdkCompatible: SdkExpectedResult = response;

    expect(sdkCompatible).toEqual(response);
    expectTypeOf(response).toExtend<SdkExpectedResult>();
  });
});

describe("TOOL_REGISTRY", () => {
  it("reports write no-overwrite failures as MCP errors", async () => {
    vi.mocked(getWriteContent).mockResolvedValueOnce({
      success: false,
      message:
        "Write failed: File already exists at existing.ts. Cannot overwrite with this tool.",
    });

    const result = await TOOL_REGISTRY.spekta_write.handler({
      path: "existing.ts",
      content: "new content",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: "text",
        text: "Write failed: File already exists at existing.ts. Cannot overwrite with this tool.",
      },
    ]);
  });

  it.each([false, true])(
    "reports status 7 with empty output=%s",
    async (empty) => {
      const secret = "ghp_abcdefghijklmnopqrstuvwxyz";
      vi.mocked(executeRtkCommand).mockResolvedValueOnce({
        available: true,
        stdout: empty
          ? ""
          : `USEFUL_START ${secret}\n${"listing line\n".repeat(3000)}USEFUL_END`,
        stderr: empty ? "" : "USEFUL_STDERR",
        exitCode: 7,
      });
      const result = await TOOL_REGISTRY.spekta_shell.handler({
        command: "ls",
      });
      expect(result.isError).toBe(true);
      const output = result.content[0].text;
      expect(output).not.toContain(secret);
      expect(getTokenCount(output)).toBeLessThanOrEqual(1000);
      if (empty) expect(output).toBe("");
      else {
        expect(output).toContain("USEFUL_START");
        expect(output).toContain("USEFUL_END");
        expect(output).toContain("USEFUL_STDERR");
        expect(output).toContain("lines collapsed");
      }
    },
  );

  it("reports missing RTK as an error", async () => {
    vi.mocked(executeRtkCommand).mockResolvedValueOnce({ available: false });
    const result = await TOOL_REGISTRY.spekta_shell.handler({ command: "ls" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/rtk[\s\S]*not found/i);
  });

  it("returns safe bounded diagnostics for thrown execution errors", async () => {
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz";
    vi.mocked(executeRtkCommand).mockRejectedValueOnce(
      new Error(
        `USEFUL_START ${secret}\n${"failure line\n".repeat(3000)}USEFUL_STDERR`,
      ),
    );
    const result = await TOOL_REGISTRY.spekta_shell.handler({ command: "ls" });
    expect(result.isError).toBe(true);
    const output = result.content[0].text;
    expect(output).toContain("USEFUL_START");
    expect(output).toContain("USEFUL_STDERR");
    expect(output).toContain("lines collapsed");
    expect(output).not.toContain(secret);
    expect(getTokenCount(output)).toBeLessThanOrEqual(1000);
  });

  it("defines spekta_grep correctly", async () => {
    const tool = TOOL_REGISTRY.spekta_grep;
    expect(tool).toBeDefined();

    // Verify schema
    const schema = tool.schema({
      pattern: { description: "search pattern" },
      path: { description: "search path" },
    });
    const parsed = schema.parse({ pattern: "test", path: "src" });
    expect(parsed).toEqual({ pattern: "test", path: "src" });

    // Verify handler
    vi.mocked(getGrepContent).mockResolvedValue("grep result");
    const result = await tool.handler({ pattern: "test", path: "src" });

    expect(result).toEqual({
      content: [{ type: "text", text: "grep result" }],
    });
    expect(getGrepContent).toHaveBeenCalledWith({
      pattern: "test",
      path: "src",
    });
  });

  it("defines spekta_shell correctly and executes safe commands", async () => {
    const tool = TOOL_REGISTRY.spekta_shell;
    expect(tool).toBeDefined();

    const schema = tool.schema({
      command: { description: "command to run" },
      args: { description: "command arguments" },
    });
    const parsed = schema.parse({ command: "ls", args: [] });
    expect(parsed).toEqual({ command: "ls", args: [] });

    vi.mocked(executeRtkCommand).mockResolvedValueOnce({
      available: true,
      stdout: "nothing to commit",
      stderr: "",
      exitCode: 0,
    });

    const result = await tool.handler({ command: "ls", args: [] });

    expect(executeRtkCommand).toHaveBeenCalledWith("ls", []);
    expect(result).toEqual({
      isError: false,
      content: [{ type: "text", text: "nothing to commit" }],
    });
  });

  it("refuses spekta_shell commands not on the allow-list", async () => {
    const tool = TOOL_REGISTRY.spekta_shell;

    const result = await tool.handler({ command: "rm", args: ["-rf", "."] });

    expect(executeRtkCommand).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });
});
