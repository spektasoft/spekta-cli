import { describe, it, expect, vi } from "vitest";
import { parseRange, getFileLines, getTokenCount } from "./read-utils";
import fs from "fs-extra";

vi.mock("fs-extra");

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
    it("should return correct lines and total count", async () => {
      const mockContent = "line1\nline2\nline3\nline4\nline5";
      // @ts-ignore
      vi.mocked(fs.readFile).mockResolvedValue(mockContent);

      const result = await getFileLines("path/to/file", { start: 2, end: 4 });
      expect(result.lines).toEqual(["line2", "line3", "line4"]);
      expect(result.total).toBe(5);
    });

    it("should handle $ end", async () => {
      const mockContent = "line1\nline2\nline3";
      // @ts-ignore
      vi.mocked(fs.readFile).mockResolvedValue(mockContent);

      const result = await getFileLines("path/to/file", { start: 2, end: "$" });
      expect(result.lines).toEqual(["line2", "line3"]);
    });
  });

  describe("getTokenCount", () => {
    it("should return a number for token count", () => {
      const text = "Hello world";
      expect(getTokenCount(text)).toBeGreaterThan(0);
    });
  });
});
