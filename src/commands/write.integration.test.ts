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

  it("should fail if file already exists", async () => {
    const targetFile = path.join(testDir, "existing.ts");
    await fs.writeFile(targetFile, "original content");

    const result = await getWriteContent(targetFile, "new content");

    expect(result.success).toBe(false);
    expect(result.message).toContain("already exists");
  });

  it("should handle deeply nested paths", async () => {
    const targetFile = path.join(testDir, "a", "b", "c", "d", "e", "deep.ts");
    const content = "export const deep = true;";

    const result = await getWriteContent(targetFile, content);

    expect(result.success).toBe(true);
    expect(await fs.pathExists(targetFile)).toBe(true);
  });
});
