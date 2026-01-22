import fs from "fs";
import { Readable } from "stream";
import { describe, expect, it, vi } from "vitest";
import {
  getFileLines,
  getTokenCount,
  parseFilePathWithRange,
  parseRange,
  validateFileRange,
} from "./read-utils";

vi.mock("fs");
vi.mock("gpt-tokenizer", () => ({
  encode: vi.fn((text: string) => ({ length: text.split(/\s+/).length })),
}));

describe("read-utils", () => {
  describe("parseRange", () => {
    it("should parse 1,$ correctly", () => {
      expect(parseRange("1,$")).toEqual({ start: 1, end: "$" });
    });

    it("should parse undefined as 1,$", () => {
      expect(parseRange(undefined)).toEqual({ start: 1, end: "$" });
    });

    it("should parse numeric ranges", () => {
      expect(parseRange("10,20")).toEqual({ start: 10, end: 20 });
    });

    it("should parse range with $ end", () => {
      expect(parseRange("50,$")).toEqual({ start: 50, end: "$" });
    });

    it("should throw on invalid range", () => {
      expect(() => parseRange("invalid")).toThrow("Invalid range format");
    });
  });

  describe("getFileLines", () => {
    it("should return correct lines using streams", async () => {
      const mockContent = "line1\nline2\nline3";
      const mockStream = Readable.from(mockContent);
      vi.mocked(fs.createReadStream).mockReturnValue(mockStream as any);

      const result = await getFileLines("test.txt", { start: 2, end: 2 });
      expect(result.lines).toEqual(["line2"]);
      expect(result.total).toBe(3); // Should count full file lines despite range
    });
  });

  describe("getTokenCount", () => {
    it("should return a number for token count", () => {
      const text = "Hello world";
      expect(getTokenCount(text)).toBeGreaterThan(0);
    });
  });

  describe("parseFilePathWithRange", () => {
    it("should parse path with full range", () => {
      const result = parseFilePathWithRange("src/main.ts[10,50]");
      expect(result).toEqual({
        path: "src/main.ts",
        range: { start: 10, end: 50 },
      });
    });

    it("should parse path with end-of-file alias", () => {
      const result = parseFilePathWithRange("src/main.ts[100,$]");
      expect(result).toEqual({
        path: "src/main.ts",
        range: { start: 100, end: "$" },
      });
    });

    it("should handle paths without brackets", () => {
      const result = parseFilePathWithRange("src/main.ts");
      expect(result).toEqual({ path: "src/main.ts" });
    });
  });

  describe("validateFileRange", () => {
    it("should return valid for content under token limit", async () => {
      const mockStream = Readable.from("line1\nline2\nline3");
      vi.mocked(fs.createReadStream).mockReturnValue(mockStream as any);

      const result = await validateFileRange(
        "test.ts",
        { start: 1, end: 3 },
        10,
      );

      expect(result.valid).toBe(true);
      expect(result.tokens).toBeLessThanOrEqual(10);
      expect(result.message).toBeUndefined();
    });

    it("should return invalid with helpful message when exceeding limit", async () => {
      const mockStream = Readable.from("word1 word2 word3 word4 word5");
      vi.mocked(fs.createReadStream).mockReturnValue(mockStream as any);

      const result = await validateFileRange(
        "test.ts",
        { start: 1, end: 1 },
        2,
      );

      expect(result.valid).toBe(false);
      expect(result.tokens).toBe(5);
      expect(result.message).toContain("exceeds token limit");
      expect(result.suggestedMaxLines).toBeDefined();
    });
  });
});
