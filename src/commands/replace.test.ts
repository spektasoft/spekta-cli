import { execa } from "execa";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getReplaceContent } from "./replace";

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

  it("should apply single replacement and generate message", async () => {
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
    expect(result.content).toContain('console.log("world")'); // The second one should remain
    expect(result.message).toContain(`#### ${testFile}`);
    expect(result.message).toContain("**Diff:**");
    expect(result.message).toContain("```diff");
    expect(result.message).toContain("-function hello() {");
    expect(result.message).toContain("+function hello() {");
    expect(result.message).toContain("**Updated Context:**");
  });

  it("should reject untracked files", async () => {
    const untrackedFile = "untracked.ts";
    await fs.writeFile(untrackedFile, "test");

    await expect(
      getReplaceContent(
        { path: untrackedFile, blocks: [] },
        "<<<<<<< SEARCH\ntest\n=======\nnew\n>>>>>>> REPLACE",
      ),
    ).rejects.toThrow("not tracked by git");

    await fs.remove(untrackedFile);
  });
});
