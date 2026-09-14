import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { getGrepContent } from "../grep-search";

describe("getGrepContent - nested blanket gitignore regression", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "spekta-grep-test-"));
    await execa("git", ["init"], { cwd: tmpDir });

    const ignoredDir = path.join(tmpDir, "ignored-folder");
    await fs.ensureDir(ignoredDir);
    // Blanket-ignore the entire folder, mirroring "spekta/.gitignore" containing "*"
    await fs.writeFile(path.join(ignoredDir, ".gitignore"), "*\n");
    await fs.writeFile(
      path.join(ignoredDir, "secret.txt"),
      "findme-secret-token",
    );

    await fs.writeFile(
      path.join(tmpDir, "visible.txt"),
      "findme-visible-token",
    );

    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    await fs.remove(tmpDir);
  });

  it("excludes files under a nested directory with a blanket gitignore", async () => {
    const result = await getGrepContent({ pattern: "findme" });
    expect(result).toContain("visible.txt");
    expect(result).not.toContain("secret.txt");
  });

  it("excludes files under a nested directory with a blanket gitignore even when glob matches them", async () => {
    const result = await getGrepContent({
      pattern: "findme",
      globs: "*secret*.*,*visible*.*",
    });
    expect(result).toContain("visible.txt");
    expect(result).not.toContain("secret.txt");
  });
});
