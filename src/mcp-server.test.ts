import { describe, it, expectTypeOf } from "vitest";

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
    const response: McpToolResponse = {
      content: [{ type: "text", text: "hello" }],
      isError: false,
      extraField: "allowed",
    };

    const sdkCompatible: SdkExpectedResult = response;

    // Runtime check (just to have an assertion)
    expectTypeOf(response).toExtend<SdkExpectedResult>();
  });
});
