import fs from "fs-extra";
import path from "node:path";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../../__tests__/workspace-fixture";
import { getGrepContent } from "../grep-search";

let fixture: WorkspaceFixture;

beforeEach(async () => {
  fixture = await createWorkspaceFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

describe("whitelisted ignored files in workspace searches", () => {
  it("finds the default whitelisted file once without user globs", async () => {
    const result = await getGrepContent(
      { pattern: "needle" },
      { root: fixture.root },
    );

    expect(result.match(/WHITELISTED/g)).toHaveLength(1);
    for (const marker of [
      "GIT_IGNORED",
      "SPEKTA_IGNORED",
      "MANAGED_IGNORED",
      "GLOBAL_IGNORED",
      "NESTED_IGNORED",
      "RESTRICTED_ENV",
      "RESTRICTED_GIT",
      "RESTRICTED_SPEKTA",
      "EXTERNAL",
    ]) {
      expect(result).not.toContain(marker);
    }
  });

  it("does not duplicate a whitelisted file when a positive glob matches it", async () => {
    const result = await getGrepContent(
      { pattern: "needle", globs: "*" },
      { root: fixture.root },
    );

    expect(result.match(/WHITELISTED/g)).toHaveLength(1);
  });

  it("finds a tracked file that Git still marks ignored when whitelisted", async () => {
    await execa("git", ["add", "--force", "work/allowed.txt"], {
      cwd: fixture.repo,
    });

    const result = await getGrepContent(
      { pattern: "needle" },
      { root: fixture.root },
    );

    expect(result).toContain("WHITELISTED");
  });

  it("keeps user globs in force for whitelisted files", async () => {
    const result = await getGrepContent(
      { pattern: "needle", globs: "real.txt" },
      { root: fixture.root },
    );

    expect(result).toContain("INTERNAL");
    expect(result).not.toContain("WHITELISTED");
  });

  it("lets a later spekta ignore rule override a whitelist", async () => {
    await fs.writeFile(
      path.join(fixture.root, ".spektaignore"),
      "!allowed.txt\nallowed.txt\n",
    );

    const result = await getGrepContent(
      { pattern: "needle" },
      { root: fixture.root },
    );

    expect(result).not.toContain("WHITELISTED");
  });

  it.each([
    ["!odd-files/**", false],
    ["!odd-files/", true],
  ] as const)(
    "safely searches whitelisted nested git-ignored filenames for %s",
    async (directoryWhitelist, includesNewlineName) => {
      const oddDir = path.join(fixture.root, "odd-files");
      await fs.ensureDir(oddDir);
      await fs.writeFile(path.join(oddDir, ".gitignore"), "*\n");
      await fs.writeFile(
        path.join(oddDir, "with space.txt"),
        "needle SPACE_WHITE\n",
      );
      await fs.writeFile(
        path.join(oddDir, "line\nbreak.txt"),
        "needle NEWLINE_WHITE\n",
      );
      await fs.writeFile(
        path.join(fixture.root, ".spektaignore"),
        `!allowed.txt\n${directoryWhitelist}\n`,
      );

      const result = await getGrepContent(
        { pattern: "needle" },
        { root: fixture.root },
      );

      expect(result).toContain("SPACE_WHITE");
      if (includesNewlineName) expect(result).toContain("NEWLINE_WHITE");
      else expect(result).not.toContain("NEWLINE_WHITE");
      expect(result).not.toContain("NESTED_IGNORED");
      expect(result).not.toContain("EXTERNAL");
    },
  );

  it("does not whitelist files hidden by nested blanket ignores in a nongit workspace", async () => {
    const root = path.join(fixture.base, "nongit-whitelist");
    const ignoredDir = path.join(root, "ignored");
    await fs.ensureDir(ignoredDir);
    await fs.writeFile(path.join(root, ".spektaignore"), "!ignored/**\n");
    await fs.writeFile(path.join(ignoredDir, ".gitignore"), "*\n");
    await fs.writeFile(
      path.join(ignoredDir, "secret.txt"),
      "needle NONGIT_NESTED_IGNORED\n",
    );

    const result = await getGrepContent({ pattern: "needle" }, { root });

    expect(result).not.toContain("NONGIT_NESTED_IGNORED");
  });

  it("allows an explicit search for a whitelisted file", async () => {
    const result = await getGrepContent(
      { pattern: "needle", path: "allowed.txt" },
      { root: fixture.root },
    );

    expect(result).toContain("WHITELISTED");
  });
});
