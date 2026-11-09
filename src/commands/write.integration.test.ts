import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "path";
import { execa } from "execa";
import { getWriteContent } from "./write";

describe("write command integration", () => {
  let testDir = "";
  const workspace = () => ({ root: testDir });

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "spekta-write-test-"));
    await execa("git", ["init", "--quiet"], { cwd: testDir });
  });

  afterEach(async () => {
    if (testDir) await fs.remove(testDir);
    testDir = "";
  });

  it("should create file with nested directory structure", async () => {
    const targetFile = path.join("src", "new", "feature", "file.ts");
    const content = 'export const test = "hello";';

    const result = await getWriteContent(targetFile, content, workspace());

    expect(result.success).toBe(true);
    expect(await fs.pathExists(path.join(testDir, targetFile))).toBe(true);

    const writtenContent = await fs.readFile(
      path.join(testDir, targetFile),
      "utf-8",
    );
    expect(writtenContent).toContain("test");
  });

  it("reports a saved file when Prettier cannot parse its contents", async () => {
    const targetFile = "invalid.ts";
    const content = "const value = ;\n";

    const result = await getWriteContent(targetFile, content, workspace());

    expect(result.success).toBe(true);
    expect(result.message).toContain(`Content was saved to "${targetFile}"`);
    expect(result.message).toContain("formatting failed:");
    expect(result.message).toContain("Retrying the mutation is unnecessary.");
    expect(await fs.readFile(path.join(testDir, targetFile), "utf-8")).toBe(
      content,
    );
  });

  it("rejects an existing file without changing its bytes", async () => {
    const targetFile = "existing.ts";
    await fs.writeFile(path.join(testDir, targetFile), "original content");

    const result = await getWriteContent(
      targetFile,
      "new content",
      workspace(),
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("already exists");
    expect(await fs.readFile(path.join(testDir, targetFile), "utf-8")).toBe(
      "original content",
    );
  });

  it("allows exactly one concurrent creator without overwriting the winner", async () => {
    const targetFile = "concurrent.txt";
    const contents = Array.from(
      { length: 12 },
      (_, index) => `writer ${index}`,
    );

    const settled = await Promise.allSettled(
      contents.map((content) =>
        getWriteContent(targetFile, content, workspace()),
      ),
    );
    const results = settled.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => !result.success)).toHaveLength(11);
    expect(contents).toContain(
      await fs.readFile(path.join(testDir, targetFile), "utf-8"),
    );
  });

  it("should handle deeply nested paths", async () => {
    const targetFile = path.join("a", "b", "c", "d", "e", "deep.ts");
    const content = "export const deep = true;";

    const result = await getWriteContent(targetFile, content, workspace());

    expect(result.success).toBe(true);
    expect(await fs.pathExists(path.join(testDir, targetFile))).toBe(true);
  });

  it("rejects write to path containing restricted directory", async () => {
    const targetFile = path.join(".gitignore", "extra", "config.ts");
    const content = "console.log('should not reach here');";

    let error: unknown;

    try {
      await getWriteContent(targetFile, content, workspace());
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
    expect(await fs.pathExists(path.join(testDir, targetFile))).toBe(false);
  });
});
