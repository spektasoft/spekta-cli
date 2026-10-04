import {
  afterEach,
  beforeEach,
  describe,
  it,
  expectTypeOf,
  vi,
  expect,
} from "vitest";
import {
  createToolRegistry,
  McpToolResponse,
  TOOL_REGISTRY,
} from "./mcp-server/registry";
import { getReadOutcome } from "../commands/read";
import { executeSafeReplace } from "../commands/replace";
import { getGrepOutcome } from "../commands/grep-search";
import { getWriteContent } from "../commands/write";
import { executeRtkCommand } from "../commands/proxy/proxy-execution";
import { getTokenCount } from "../utils/read-utils";
import { getGrepResponseTokenCount } from "../commands/grep-output-parser";
import { runGrep } from "../commands/grep";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";

vi.mock("../commands/read", () => ({ getReadOutcome: vi.fn() }));
vi.mock("../commands/replace", () => ({ executeSafeReplace: vi.fn() }));
vi.mock("../commands/write", () => ({ getWriteContent: vi.fn() }));
vi.mock("../commands/grep-search", () => ({ getGrepOutcome: vi.fn() }));
vi.mock("../commands/proxy/proxy-execution", () => ({
  executeRtkCommand: vi.fn(),
}));
vi.mock("../core/config", () => ({
  bootstrap: vi.fn(),
  loadToolDefinitions: vi.fn().mockResolvedValue([]),
  getIgnorePatterns: () => Promise.resolve([]),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
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
        stdout: empty ? "" : `.env\n${secret}\n`,
        stderr: empty ? "" : "USEFUL_STDERR",
        exitCode: 7,
      });
      const result = await TOOL_REGISTRY.spekta_shell.handler({
        command: "ls",
      });
      expect(result).toEqual({
        isError: true,
        content: [
          { type: "text", text: "RTK command failed with exit status 7." },
        ],
      });
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
    expect(output).toContain("RTK listing failed");
    expect(output).not.toContain("USEFUL_START");
    expect(output).not.toContain("USEFUL_STDERR");
    expect(output).not.toContain("failure line");
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
    vi.mocked(getGrepOutcome).mockResolvedValue({
      status: "success",
      value: "grep result",
    });
    const result = await tool.handler({ pattern: "test", path: "src" });

    expect(result).toEqual({
      content: [{ type: "text", text: "grep result" }],
    });
    expect(getGrepOutcome).toHaveBeenCalledWith(
      {
        pattern: "test",
        path: "src",
      },
      undefined,
      undefined,
    );
  });

  it("renders bounded grep outcomes with MCP status metadata", async () => {
    const tool = TOOL_REGISTRY.spekta_grep;
    vi.mocked(getGrepOutcome).mockResolvedValueOnce({
      status: "output_limit_exceeded",
      message:
        "Search results exceed the response budget; all matches were withheld. Narrow the path or pattern.",
    });
    const limited = await tool.handler({ pattern: "needle" });
    expect(limited.isError).toBeUndefined();
    expect(limited.content[0].text).toContain("all matches were withheld");
    expect(
      getGrepResponseTokenCount(limited.content[0].text, "request-42"),
    ).toBeLessThanOrEqual(2000);

    vi.mocked(getGrepOutcome).mockResolvedValueOnce({
      status: "engine_failure",
      message: "Search failed.",
    });
    const failure = await tool.handler({ pattern: "needle" });
    expect(failure.isError).toBe(true);
    expect(
      getGrepResponseTokenCount(failure.content[0].text, "request-42", true),
    ).toBeLessThanOrEqual(2000);
  });

  it.each([
    {
      status: "success" as const,
      value: "#### src/file.ts\n```ts\n1:0:needle\n```",
    },
    {
      status: "output_limit_exceeded" as const,
      message:
        "Search results exceed the response budget; all matches were withheld. Narrow the path or pattern.",
    },
  ])("keeps CLI and MCP grep rendering in parity", async (outcome) => {
    vi.mocked(getGrepOutcome).mockResolvedValueOnce(outcome);
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await runGrep(["needle"]);
    const cliOutput = writeSpy.mock.calls
      .map(([chunk]) => String(chunk))
      .join("");
    writeSpy.mockRestore();

    vi.mocked(getGrepOutcome).mockResolvedValueOnce(outcome);
    const mcp = await TOOL_REGISTRY.spekta_grep.handler({ pattern: "needle" });
    expect(cliOutput).toBe(`${mcp.content[0].text}\n`);
    expect(
      getGrepResponseTokenCount(mcp.content[0].text, "request-42"),
    ).toBeLessThanOrEqual(2000);
  });

  it("budgets MCP results against the actual request ID", async () => {
    const requestId = `mcp-request-${"x".repeat(300)}`;
    vi.mocked(getGrepOutcome).mockResolvedValueOnce({
      status: "success",
      value: "matches",
    });
    const response = await TOOL_REGISTRY.spekta_grep.handler(
      { pattern: "needle" },
      undefined,
      requestId,
    );
    const text = response.content[0].text;
    expect(getGrepResponseTokenCount(text, requestId)).toBeLessThanOrEqual(
      2000,
    );
    expect(getGrepResponseTokenCount(text, requestId)).toBeGreaterThan(
      getGrepResponseTokenCount(text, "mcp-request-1"),
    );
    expect(getGrepOutcome).toHaveBeenCalledWith(
      { pattern: "needle" },
      undefined,
      requestId,
    );
  });

  it("binds documented operations to the server workspace and ignores injected grep context", async () => {
    const workspace = Object.freeze({ root: "/canonical/repo" });
    const tools = createToolRegistry(workspace);
    vi.mocked(getReadOutcome).mockResolvedValueOnce({
      status: "success",
      value: "read result",
    });
    vi.mocked(getGrepOutcome).mockResolvedValueOnce({
      status: "success",
      value: "grep result",
    });
    vi.mocked(getWriteContent).mockResolvedValueOnce({
      success: true,
      message: "written",
    });
    vi.mocked(executeSafeReplace).mockResolvedValueOnce({
      message: "replaced",
      appliedCount: 1,
    });

    await tools.spekta_read.handler({ paths: ["src/file.ts"] });
    await tools.spekta_grep.handler({
      pattern: "needle",
      path: "src",
      globs: "*.ts",
      case_insensitive: true,
      cwd: "/attacker",
      workspace: { root: "/attacker" },
      root: "/attacker",
    });
    await tools.spekta_write.handler({ path: "new.ts", content: "body" });
    await tools.spekta_replace.handler({
      path: "old.ts",
      blocks: "replacement blocks",
    });

    expect(getReadOutcome).toHaveBeenCalledWith(
      [{ path: "src/file.ts" }],
      false,
      workspace,
      undefined,
    );
    expect(getGrepOutcome).toHaveBeenCalledWith(
      {
        pattern: "needle",
        path: "src",
        globs: "*.ts",
        case_insensitive: true,
      },
      workspace,
      undefined,
    );
    expect(getWriteContent).toHaveBeenCalledWith("new.ts", "body", workspace);
    expect(executeSafeReplace).toHaveBeenCalledWith(
      { path: "old.ts", blocks: [] },
      "replacement blocks",
      workspace,
    );
  });

  it("reports read budget exhaustion as an MCP error and passes request ID", async () => {
    vi.mocked(getReadOutcome).mockResolvedValueOnce({
      status: "output_limit_exceeded",
      message: "partial read [INCOMPLETE]",
    });
    const result = await TOOL_REGISTRY.spekta_read.handler(
      { paths: ["src/file.ts"] },
      undefined,
      "request-42",
    );
    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: "partial read [INCOMPLETE]" }],
    });
    expect(getReadOutcome).toHaveBeenCalledWith(
      [{ path: "src/file.ts" }],
      false,
      undefined,
      "request-42",
    );
  });

  it("passes the bound workspace to shell validation and execution", async () => {
    const workspace = Object.freeze({ root: "/canonical/repo" });
    const shell = createToolRegistry(workspace).spekta_shell;
    const proxyPolicy = await import("../commands/proxy/proxy-policy");
    const validateSpy = vi
      .spyOn(proxyPolicy, "validateProxyRequest")
      .mockImplementation(() => undefined);
    vi.mocked(executeRtkCommand).mockResolvedValueOnce({
      available: true,
      stdout: "clean",
      stderr: "",
      exitCode: 0,
    });
    await shell.handler({ command: "git", args: ["status", "--short"] });
    expect(validateSpy).toHaveBeenCalledWith(
      "git",
      ["status", "--short"],
      workspace,
    );
    expect(executeRtkCommand).toHaveBeenCalledWith(
      "git",
      ["status", "--short"],
      workspace,
    );
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

    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "spekta-mcp-ls-")),
    );
    try {
      fs.writeFileSync(path.join(root, "visible.txt"), "x");
      fs.writeFileSync(path.join(root, ".env"), "SECRET=1");
      vi.mocked(executeRtkCommand).mockResolvedValueOnce({
        available: true,
        stdout: ".env\nvisible.txt\n",
        stderr: "",
        exitCode: 0,
      });

      const result = await createToolRegistry({ root }).spekta_shell.handler({
        command: "ls",
        args: [],
      });

      expect(executeRtkCommand).toHaveBeenCalledWith("ls", [], { root });
      expect(result).toEqual({
        isError: false,
        content: [{ type: "text", text: '"visible.txt"' }],
      });
    } finally {
      fs.removeSync(root);
    }
  });

  it("refuses spekta_shell commands not on the allow-list", async () => {
    const tool = TOOL_REGISTRY.spekta_shell;

    const result = await tool.handler({ command: "rm", args: ["-rf", "."] });

    expect(executeRtkCommand).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });
});
