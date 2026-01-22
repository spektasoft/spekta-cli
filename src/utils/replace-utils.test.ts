import { describe, expect, it } from "vitest";
import { normalizeWhitespace, parseReplaceBlocks } from "./replace-utils";

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
