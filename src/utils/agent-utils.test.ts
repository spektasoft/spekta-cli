import { expect, it, describe } from "vitest";
import { parseToolCalls, validateFilePath } from "./agent-utils";

describe("agent-utils", () => {
  describe("parseToolCalls", () => {
    it("parses tool calls with proper validation", () => {
      const text =
        '<read path="safe/file.txt" /><write path="safe/output.txt">content</write>';
      const calls = parseToolCalls(text);

      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual({
        type: "read",
        path: "safe/file.txt",
        raw: '<read path="safe/file.txt" />',
      });
      expect(calls[1]).toEqual({
        type: "write",
        path: "safe/output.txt",
        content: "content",
        raw: '<write path="safe/output.txt">content</write>',
      });
    });

    it("rejects dangerous paths during parsing", () => {
      const text1 = '<write path="../../../etc/passwd">malicious</write>';
      const calls1 = parseToolCalls(text1);
      expect(calls1).toHaveLength(0);

      const text2 = '<read path="/etc/passwd" />';
      const calls2 = parseToolCalls(text2);
      expect(calls2).toHaveLength(0);
    });

    it("handles self-closing read tags correctly", () => {
      const text = '<read path="src/main.ts" />';
      const calls = parseToolCalls(text);

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        type: "read",
        path: "src/main.ts",
        raw: '<read path="src/main.ts" />',
      });
    });
  });

  describe("validateFilePath", () => {
    it("validates file paths for security", async () => {
      // Test valid path
      expect(validateFilePath("src/file.ts")).toBe(true);
      expect(validateFilePath("file.ts")).toBe(true);

      // Test invalid paths
      expect(validateFilePath("../outside/file.ts")).toBe(false);
      expect(validateFilePath("/absolute/path/file.ts")).toBe(false);
      expect(validateFilePath("/etc/passwd")).toBe(false);
    });
  });
});