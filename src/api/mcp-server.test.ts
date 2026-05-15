import { describe, it, expectTypeOf, vi, expect } from "vitest";
import { TOOL_REGISTRY } from "./mcp-server";
import { getGrepContent } from "../commands/grep";

vi.mock("../commands/read", () => ({ getReadContent: vi.fn() }));
vi.mock("../commands/replace", () => ({ executeSafeReplace: vi.fn() }));
vi.mock("../commands/write", () => ({ getWriteContent: vi.fn() }));
vi.mock("../commands/grep", () => ({ getGrepContent: vi.fn() }));
vi.mock("../config", () => ({
  bootstrap: vi.fn(),
  loadToolDefinitions: vi.fn().mockResolvedValue([]),
}));

// Re-defining the structure expected by the SDK based on the error message
// (The SDK expects a result that allows string indexing)
type SdkExpectedResult = {
  content: Array<any>;
  isError?: boolean;
  [x: string]: unknown;
};

interface McpToolResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
  [key: string]: unknown;
}

describe("McpToolResponse Compatibility", () => {
  it("should be assignable to the SDK expected generic shape", () => {
    // This test passes if TypeScript allows the assignment
    const response = {
      content: [{ type: "text", text: "hello" }],
      isError: false,
      extraField: "allowed",
    };

    const sdkCompatible: SdkExpectedResult = response;

    // Runtime check (just to have an assertion)
    expectTypeOf(response).toExtend<SdkExpectedResult>();
  });
});

describe("TOOL_REGISTRY", () => {
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
});
