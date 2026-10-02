import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "path";
import { getWriteContent } from "./write";

describe("write command integration", () => {
  const testDir = path.join(process.cwd(), "test-temp-write");

  beforeEach(async () => {
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it("should create file with nested directory structure", async () => {
    const targetFile = path.join(testDir, "src", "new", "feature", "file.ts");
    const content = 'export const test = "hello";';

    const result = await getWriteContent(targetFile, content);

    expect(result.success).toBe(true);
    expect(await fs.pathExists(targetFile)).toBe(true);

    const writtenContent = await fs.readFile(targetFile, "utf-8");
    expect(writtenContent).toContain("test");
  });

  it("rejects an existing file without changing its bytes", async () => {
    const targetFile = path.join(testDir, "existing.ts");
    await fs.writeFile(targetFile, "original content");

    const result = await getWriteContent(targetFile, "new content");

    expect(result.success).toBe(false);
    expect(result.message).toContain("already exists");
    expect(await fs.readFile(targetFile, "utf-8")).toBe("original content");
  });

  it("allows exactly one concurrent creator without overwriting the winner", async () => {
    const targetFile = path.join(testDir, "concurrent.txt");
    const contents = Array.from(
      { length: 12 },
      (_, index) => `writer ${index}`,
    );

    const results = await Promise.all(
      contents.map((content) => getWriteContent(targetFile, content)),
    );

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => !result.success)).toHaveLength(11);
    expect(contents).toContain(await fs.readFile(targetFile, "utf-8"));
  });

  it("should handle deeply nested paths", async () => {
    const targetFile = path.join(testDir, "a", "b", "c", "d", "e", "deep.ts");
    const content = "export const deep = true;";

    const result = await getWriteContent(targetFile, content);

    expect(result.success).toBe(true);
    expect(await fs.pathExists(targetFile)).toBe(true);
  });

  it("rejects write to path containing restricted directory", async () => {
    const targetFile = path.join(testDir, ".gitignore", "extra", "config.ts");
    const content = "console.log('should not reach here');";

    let error: unknown;

    try {
      await getWriteContent(targetFile, content);
    } catch (err) {
      error = err;
    }

    // If getWriteContent throws an error, that's the expected behavior
    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) {
      expect(error.message).toMatch(
        /Cannot create file or directories under restricted path segment: \.gitignore/,
      );
    }
    expect(await fs.pathExists(targetFile)).toBe(false);
  });
});
