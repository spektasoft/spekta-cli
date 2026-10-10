import fs, { ReadStream } from "fs";
import { Readable } from "stream";
import { describe, expect, it, vi } from "vitest";
import {
  getFileLines,
  getVersionedFileLines,
  isReadVersion,
  getTokenCount,
  parseFilePathWithRange,
  parseRange,
  tokenizeQuotedPaths,
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
      vi.mocked(fs.createReadStream).mockReturnValue(
        mockStream as unknown as ReadStream,
      );

      const result = await getFileLines("test.txt", { start: 2, end: 2 });
      expect(result.lines).toEqual(["line2"]);
      expect(result.total).toBe(3); // Should count full file lines despite range
    });
  });

  describe("getVersionedFileLines", () => {
    it("reads bytes once, returns selected and full lines, and versions path and exact bytes", async () => {
      const stream = (bytes: string) =>
        Readable.from([Buffer.from(bytes)]) as unknown as ReadStream;
      vi.mocked(fs.createReadStream).mockClear();
      vi.mocked(fs.createReadStream).mockReturnValueOnce(stream("a\r\nb\r\n"));
      const result = await getVersionedFileLines("/canonical/a", {
        start: 2,
        end: "$",
      });
      expect(result).toMatchObject({
        lines: ["b"],
        fullLines: ["a", "b"],
        total: 2,
      });
      expect(isReadVersion(result.version)).toBe(true);
      expect(fs.createReadStream).toHaveBeenCalledTimes(1);
      vi.mocked(fs.createReadStream).mockReturnValueOnce(stream("a\r\nb\r\n"));
      expect(
        (await getVersionedFileLines("/canonical/a", { start: 1, end: "$" }))
          .version,
      ).toBe(result.version);
      vi.mocked(fs.createReadStream).mockReturnValueOnce(stream("a\r\nb\r\n"));
      expect(
        (await getVersionedFileLines("/canonical/b", { start: 1, end: "$" }))
          .version,
      ).not.toBe(result.version);
      vi.mocked(fs.createReadStream).mockReturnValueOnce(stream("a\nb\n"));
      expect(
        (await getVersionedFileLines("/canonical/a", { start: 1, end: "$" }))
          .version,
      ).not.toBe(result.version);
    });

    it.each(["", "tail", "tail\n", "สวัสดี 🌏\n"])(
      "handles original bytes %j",
      async (bytes) => {
        vi.mocked(fs.createReadStream).mockReturnValueOnce(
          Readable.from([Buffer.from(bytes)]) as unknown as ReadStream,
        );
        const result = await getVersionedFileLines("/canonical/file", {
          start: 1,
          end: "$",
        });
        expect(result.fullLines.join("\n")).toBe(bytes.replace(/\r?\n$/, ""));
        expect(isReadVersion(result.version)).toBe(true);
      },
    );

    it("propagates stream errors without returning a snapshot", async () => {
      const stream = new Readable({
        read() {
          this.destroy(new Error("stream failed"));
        },
      });
      vi.mocked(fs.createReadStream).mockReturnValueOnce(
        stream as unknown as ReadStream,
      );
      await expect(
        getVersionedFileLines("/canonical/file", { start: 1, end: "$" }),
      ).rejects.toThrow("stream failed");
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
      vi.mocked(fs.createReadStream).mockReturnValue(
        mockStream as unknown as ReadStream,
      );

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
      vi.mocked(fs.createReadStream).mockReturnValue(
        mockStream as unknown as ReadStream,
      );

      const result = await validateFileRange(
        "test.ts",
        { start: 1, end: 1 },
        2,
      );

      expect(result.valid).toBe(false);
      expect(result.tokens).toBe(5);
      expect(result.message).toContain("Range exceeds token limit");
      expect(result.suggestedMaxLines).toBeDefined();
    });

    it("should provide specific error message for full file vs range", async () => {
      const mockStreamFull = Readable.from("word1 word2 word3 word4 word5");
      vi.mocked(fs.createReadStream).mockReturnValueOnce(
        mockStreamFull as unknown as ReadStream,
      );

      const resultFull = await validateFileRange(
        "large-file.ts",
        { start: 1, end: "$" },
        2,
      );
      expect(resultFull.valid).toBe(false);
      expect(resultFull.message).toContain("Full file exceeds token limit");

      const mockStreamRange = Readable.from(
        "word1\nword2\nword3\nword4\nword5",
      );
      vi.mocked(fs.createReadStream).mockReturnValueOnce(
        mockStreamRange as unknown as ReadStream,
      );

      const resultRange = await validateFileRange(
        "large-file.ts",
        { start: 2, end: 5 },
        2,
      );
      expect(resultRange.valid).toBe(false);
      expect(resultRange.message).toContain("Range exceeds token limit");
    });
  });
});

describe("tokenizeQuotedPaths", () => {
  it("handles simple unquoted paths", () => {
    expect(tokenizeQuotedPaths("a.ts b.ts")).toEqual(["a.ts", "b.ts"]);
  });

  it("handles quoted paths with spaces", () => {
    expect(tokenizeQuotedPaths(`a.ts "b file.ts" 'c file.ts'`)).toEqual([
      "a.ts",
      "b file.ts",
      "c file.ts",
    ]);
  });

  it("handles ranged paths inside quotes", () => {
    expect(tokenizeQuotedPaths(`"file.ts[1,10]" normal.ts[5,$]`)).toEqual([
      "file.ts[1,10]",
      "normal.ts[5,$]",
    ]);
  });

  it("handles empty input", () => {
    expect(tokenizeQuotedPaths("")).toEqual([]);
  });
});
