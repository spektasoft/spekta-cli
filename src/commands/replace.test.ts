import fs from "fs-extra";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getReplaceContent } from "./replace";
import { ReplaceRequest } from "../utils/replace-utils";
import * as security from "../utils/security";

// Mock security validation to isolate logic from Git environment
vi.mock("../utils/security", () => ({
  validateEditAccess: vi.fn().mockResolvedValue(undefined),
}));

describe("getReplaceContent", () => {
  const sandboxDir = path.resolve("test-sandbox-unit");

  beforeEach(async () => {
    await fs.ensureDir(sandboxDir);
  });

  afterEach(async () => {
    await fs.remove(sandboxDir);
    vi.clearAllMocks();
  });

  it("should apply single replacement and generate minimal message", async () => {
    const testFile = path.join(sandboxDir, "test-replace.ts");
    const content = `function hello() {\n  console.log("world");\n}`;
    await fs.writeFile(testFile, content);

    const blocks = `<<<<<<< SEARCH
function hello() {
  console.log("world");
}
=======
function hello() {
  console.log("universe");
}
>>>>>>> REPLACE`;

    const result = await getReplaceContent(
      { path: testFile, blocks: [] },
      blocks,
    );

    expect(result.appliedCount).toBe(1);
    expect(result.content).toContain('console.log("universe")');
    expect(result.message).toBe(
      `Replaced 1 block(s) in ${testFile}\nLine ranges: 1-3`,
    );
  });

  it("should respect security validation failures", async () => {
    vi.mocked(security.validateEditAccess).mockRejectedValueOnce(
      new Error("Security Violation"),
    );

    await expect(
      getReplaceContent(
        { path: "any-file.ts", blocks: [] },
        "<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE",
      ),
    ).rejects.toThrow("Security Violation");
  });

  it("generates minimal summary for single replacement", async () => {
    const mockContent = "line1\nline2\nline3\nline4\nline5";
    const filePath = path.join(sandboxDir, "test.txt");
    await fs.writeFile(filePath, mockContent);

    const request: any = {
      path: filePath,
      blocks: [{ search: "line3", replace: "updated" }],
    };

    const { message, appliedCount } = await getReplaceContent(request);

    expect(appliedCount).toBe(1);
    expect(message).toContain(`Replaced 1 block(s) in ${filePath}`);
    expect(message).toContain("Line ranges: 3-3");
  });

  it("caps line ranges display at 5 for bulk replacements and uses unique matches", async () => {
    const filePath = path.join(sandboxDir, "bulk.txt");
    // Use unique prefixes to avoid ambiguous matches (e.g., "L2" vs "L20")
    const mockContent = Array.from(
      { length: 30 },
      (_, i) => `UNIQUE_ID_${String(i + 1).padStart(2, "0")}`,
    ).join("\n");
    await fs.writeFile(filePath, mockContent);

    // Replace IDs 02, 04, 06, 08, 10, 12, 14, 16
    const blocks = Array.from({ length: 8 }, (_, i) => ({
      search: `UNIQUE_ID_${String((i + 1) * 2).padStart(2, "0")}`,
      replace: `UPDATED_${String((i + 1) * 2).padStart(2, "0")}`,
    }));

    const request: ReplaceRequest = { path: filePath, blocks };
    const { message, appliedCount } = await getReplaceContent(request);

    expect(appliedCount).toBe(8);
    expect(message).toContain("First 5 line ranges:");
    expect(message).toContain("(and 3 more)");
  });

  it("rejects excessive block count", async () => {
    const manyBlocks = Array.from({ length: 51 }, () => ({
      search: "a",
      replace: "b",
    }));

    await expect(
      getReplaceContent({ path: "test.txt", blocks: manyBlocks }, ""),
    ).rejects.toThrow(/Too many replacement blocks/);
  });

  it("generates correct message when nothing matches", async () => {
    const testFile = path.join(sandboxDir, "test-no-match.txt");
    const content = `line1\nline2\nline3`;
    await fs.writeFile(testFile, content);

    await expect(
      getReplaceContent(
        { path: testFile, blocks: [{ search: "nonexistent", replace: "x" }] },
        undefined,
      ),
    ).rejects.toThrow(
      /The SEARCH block could not be found. Ensure the search text matches the file content exactly, including indentation./,
    );
  });
});
