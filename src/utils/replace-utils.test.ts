import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import {
  applyReplacements,
  detectLineEnding,
  findUniqueMatch,
  getLineNumberFromOffset,
  getTotalLines,
  normalizeWhitespace,
  parseReplaceBlocks,
} from "./replace-utils";

describe("getLineNumberFromOffset", () => {
  it("should return correct line number for offset", () => {
    const content = "line 1\nline 2\nline 3";
    expect(getLineNumberFromOffset(content, 0)).toBe(1);
    expect(getLineNumberFromOffset(content, 7)).toBe(2);
    expect(getLineNumberFromOffset(content, 14)).toBe(3);
  });

  it("should handle CRLF line endings", () => {
    const content = "line 1\r\nline 2";
    expect(getLineNumberFromOffset(content, 8)).toBe(2);
  });
});

describe("getTotalLines", () => {
  it("should return total line count", () => {
    expect(getTotalLines("line 1\nline 2")).toBe(2);
    expect(getTotalLines("line 1\r\nline 2\r\nline 3")).toBe(3);
    expect(getTotalLines("")).toBe(1);
  });
});

describe("detectLineEnding", () => {
  it("should detect CRLF line endings", () => {
    expect(detectLineEnding("line1\r\nline2")).toBe("\r\n");
  });

  it("should detect LF line endings", () => {
    expect(detectLineEnding("line1\nline2")).toBe("\n");
  });
});

describe("findUniqueMatch", () => {
  it("should find unique match in content", () => {
    const content = "function first() {}\nfunction second() {}";
    const search = "function second() {}";
    const match = findUniqueMatch(content, search);
    expect(content.substring(match.start, match.end)).toBe(search);
  });

  it("should ignore whitespace differences during matching", () => {
    const content = "function  test()  {\n  return 1;\n}";
    const search = "function test() {\nreturn 1;\n}";
    const match = findUniqueMatch(content, search);
    expect(match.start).toBe(0);
    expect(match.end).toBe(content.length);
  });

  it("should throw error if no match is found", () => {
    const content = "function first() {}";
    const search = "function third() {}";
    expect(() => findUniqueMatch(content, search)).toThrow(
      "The search block was not found in the file",
    );
  });

  it("should throw error if match is ambiguous", () => {
    const content = "function test() {}\nfunction test() {}";
    const search = "function test() {}";
    expect(() => findUniqueMatch(content, search)).toThrow(
      "Ambiguous match: Found 2 occurrences",
    );
  });
});

describe("applyReplacements Integration", () => {
  let tempFile: string;

  beforeEach(async () => {
    tempFile = path.join(os.tmpdir(), `spekta-test-${Date.now()}.txt`);
  });

  afterEach(async () => {
    if (await fs.pathExists(tempFile)) {
      await fs.remove(tempFile);
    }
  });

  it("should apply multiple replacements correctly", async () => {
    const content = "line 1\nline 2\nline 3";
    await fs.writeFile(tempFile, content);

    const blocks = [
      { search: "line 1", replace: "updated 1" },
      { search: "line 3", replace: "updated 3" },
    ];

    const result = await applyReplacements(tempFile, blocks);
    expect(result.appliedBlocks).toHaveLength(2);
    expect(result.content).toBe("updated 1\nline 2\nupdated 3");
  });

  it("should handle CRLF line endings in replacements", async () => {
    const content = "line 1\r\nline 2";
    await fs.writeFile(tempFile, content);

    const blocks = [{ search: "line 1", replace: "updated 1" }];

    const result = await applyReplacements(tempFile, blocks);
    expect(result.content).toBe("updated 1\r\nline 2");
  });

  it("should throw error when any search block is not found (atomic behavior)", async () => {
    const content = `line1\nline2\nline3\nline4\nline5`;
    await fs.writeFile(tempFile, content);

    const blocks = [
      { search: "line1", replace: "modified1" }, // This will match
      { search: "nonexistent", replace: "x" }, // This won't match
    ];

    await expect(applyReplacements(tempFile, blocks)).rejects.toThrow(
      "search block was not found",
    );

    // Verify no changes were made to the file
    const finalContent = await fs.readFile(tempFile, "utf-8");
    expect(finalContent).toBe(content);
  });

  it("should apply all replacements when all blocks match", async () => {
    const content = `line1\nline2\nline3\nline4\nline5`;
    await fs.writeFile(tempFile, content);

    const blocks = [
      { search: "line1", replace: "modified1" },
      { search: "line3", replace: "modified3" },
    ];

    const result = await applyReplacements(tempFile, blocks);

    expect(result.content).toBe("modified1\nline2\nmodified3\nline4\nline5");
    expect(result.appliedBlocks).toHaveLength(2);
  });
});

describe("normalizeWhitespace", () => {
  it("should normalize tabs to spaces", () => {
    expect(normalizeWhitespace("\t\tcode")).toBe("    code");
  });

  it("should remove trailing whitespace", () => {
    expect(normalizeWhitespace("code   \n  more  ")).toBe("code\n  more");
  });

  it("should normalize line endings", () => {
    expect(normalizeWhitespace("line1\r\nline2")).toBe("line1\nline2");
  });
});

describe("parseReplaceBlocks", () => {
  it("should parse single SEARCH/REPLACE block", () => {
    const input = `<<<<<<< SEARCH
old code
=======
new code
>>>>>>> REPLACE`;

    const blocks = parseReplaceBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].search).toBe("old code");
    expect(blocks[0].replace).toBe("new code");
  });

  it("should parse multiple blocks", () => {
    const input = `<<<<<<< SEARCH
old1
=======
new1
>>>>>>> REPLACE
<<<<<<< SEARCH
old2
=======
new2
>>>>>>> REPLACE`;

    const blocks = parseReplaceBlocks(input);
    expect(blocks).toHaveLength(2);
  });

  it("should throw on invalid format", () => {
    expect(() => parseReplaceBlocks("invalid")).toThrow(
      "No SEARCH/REPLACE blocks found",
    );
  });
});
