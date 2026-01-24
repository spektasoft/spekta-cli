import { describe, expect, it } from "vitest";
import { parseToolCalls, validateFilePath } from "../utils/agent-utils";

describe("Agent Read Tool Security - E2E", () => {
  it("agent read tool parses single file request securely", async () => {
    const xmlInput = `<read path="src/index.ts" />`;
    const calls = parseToolCalls(xmlInput);
    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe("read");
    expect(calls[0].path).toBe("src/index.ts");
  });

  it("rejects malicious paths with path traversal", async () => {
    // Test various malicious patterns
    const maliciousPatterns = [
      `<read path="../secret/file.ts" />`,
      `<read path="/etc/passwd" />`,
      `<read path="src/../../../etc/passwd" />`,
      `<read path="..\\secret\\file.ts" />`, // Windows-style path traversal
    ];

    for (const pattern of maliciousPatterns) {
      const calls = parseToolCalls(pattern);
      expect(calls).toHaveLength(0);
    }
  });

  it("validates file paths correctly", async () => {
    // Test valid paths
    expect(validateFilePath("src/index.ts")).toBe(true);
    expect(validateFilePath("test file.ts")).toBe(true);
    expect(validateFilePath("src/types/main.ts")).toBe(true);

    // Test invalid paths
    expect(validateFilePath("../outside/file.ts")).toBe(false);
    expect(validateFilePath("/absolute/path/file.ts")).toBe(false);
    expect(validateFilePath("/etc/passwd")).toBe(false);
    expect(validateFilePath("..\\secret\\file.ts")).toBe(true);
  });
});
