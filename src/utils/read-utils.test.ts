import fs from "fs";
import { Readable } from "stream";
import { describe, expect, it, vi } from "vitest";
import { getFileLines, getTokenCount, parseRange } from "./read-utils";

vi.mock("fs");

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
});
