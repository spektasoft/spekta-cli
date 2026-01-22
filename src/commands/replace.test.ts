import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getReplaceContent } from "./replace";
import fs from "fs-extra";
import path from "path";
import { execa } from "execa";

describe("getReplaceContent", () => {
  const testFile = "test-replace.ts";

  beforeEach(async () => {
    const content = `function hello() {
  console.log("world");
}

function goodbye() {
  console.log("world");
}`;
    await fs.writeFile(testFile, content);
    // Ensure file is tracked by git
    try {
      await execa("git", ["add", testFile]);
    } catch (e) {
      // In case we are not in a git repo during tests, 
      // but usually the project is a git repo.
    }
  });

  afterEach(async () => {
    try {
      await execa("git", ["rm", "--cached", testFile]);
    } catch (e) {}
    await fs.remove(testFile);
  });

  it("should apply single replacement", async () => {
    const blocks = `<<<<<<< SEARCH
console.log("world");
=======
console.log("universe");
>>>>>>> REPLACE`;

    const result = await getReplaceContent(
      { path: testFile, range: { start: 1, end: 3 }, blocks: [] },
      blocks,
    );

    expect(result.appliedCount).toBe(1);
    expect(result.content).toContain('console.log("universe")');
  });

  it("should reject untracked files", async () => {
    const untrackedFile = "untracked.ts";
    await fs.writeFile(untrackedFile, "test");

    await expect(
      getReplaceContent(
        { path: untrackedFile, range: { start: 1, end: 1 }, blocks: [] },
        "<<<<<<< SEARCH\ntest\n=======\nnew\n>>>>>>> REPLACE",
      ),
    ).rejects.toThrow("not tracked by git");

    await fs.remove(untrackedFile);
  });
});
