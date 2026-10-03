import fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOOL_REGISTRY } from "../api/mcp-server/registry";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../__tests__/workspace-fixture";
import * as formatUtils from "../utils/format-utils";
import type { WorkspaceContext } from "../utils/workspace";
import { executeSafeReplace, getReplaceContent, runReplace } from "./replace";
import { getWriteContent, runWrite } from "./write";

const replaceBlock = (search: string, replacement: string) =>
  `<<<<<<< SEARCH\n${search}\n=======\n${replacement}\n>>>>>>> REPLACE`;

describe("create and replace workspace boundary integration", () => {
  let fixture: WorkspaceFixture;
  let originalExitCode: typeof process.exitCode;

  beforeEach(async () => {
    fixture = await createWorkspaceFixture();
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    process.chdir(fixture.root);
  });

  afterEach(async () => {
    process.exitCode = originalExitCode;
    await fixture.cleanup();
    vi.restoreAllMocks();
  });

  const context = (root = fixture.root): WorkspaceContext => ({ root });

  it("creates nested files and replaces eligible files in an explicit workspace away from cwd", async () => {
    process.chdir(fixture.ambient);
    const target = path.join(fixture.root, "new", "nested", "file.md");
    const original = "before value\n";
    const created = await getWriteContent(
      "new/nested/file.md",
      original,
      context(),
    );

    expect(created.success).toBe(true);
    expect(await fs.readFile(target, "utf-8")).toBe(original);

    const prepared = await getReplaceContent(
      { path: "new/nested/file.md", blocks: [] },
      replaceBlock("before value", "after value"),
      context(),
    );
    expect(prepared.content).toBe("after value\n");
    expect(await fs.readFile(target, "utf-8")).toBe(original);

    const replaced = await executeSafeReplace(
      { path: "new/nested/file.md", blocks: [] },
      replaceBlock("before value", "after value"),
      context(),
    );
    expect(replaced.appliedCount).toBe(1);
    expect(await fs.readFile(target, "utf-8")).toBe("after value\n");
  });

  it("rejects relative and absolute siblings outside the effective workspace through APIs, CLI, and MCP", async () => {
    const sibling = path.join(fixture.repo, "sibling.txt");
    const originalSibling = await fs.readFile(sibling, "utf-8");
    const format = vi.spyOn(formatUtils, "formatFileInPlace");
    const ensureDir = vi.spyOn(fs, "ensureDir");
    const writeFile = vi.spyOn(fs, "writeFile");

    await expect(
      getWriteContent("../sibling-created.txt", "escape", context()),
    ).rejects.toThrow(/outside|denied/i);
    await expect(
      getWriteContent(
        path.join(fixture.repo, "absolute-created.txt"),
        "escape",
        context(),
      ),
    ).rejects.toThrow(/outside|denied/i);
    await expect(
      executeSafeReplace(
        { path: sibling, blocks: [] },
        replaceBlock("SIBLING", "CHANGED"),
        context(),
      ),
    ).rejects.toThrow(/outside|denied/i);
    await expect(
      getReplaceContent(
        { path: sibling, blocks: [] },
        replaceBlock("SIBLING", "CHANGED"),
        context(),
      ),
    ).rejects.toThrow(/outside|denied/i);

    const mcpWrite = await TOOL_REGISTRY.spekta_write.handler({
      path: "../mcp-created.txt",
      content: "escape",
    });
    expect(mcpWrite.isError).toBe(true);
    const mcpReplace = await TOOL_REGISTRY.spekta_replace.handler({
      path: sibling,
      blocks: replaceBlock("SIBLING", "CHANGED"),
    });
    expect(mcpReplace.isError).toBe(true);

    await runWrite(["../cli-created.txt", "escape"]);
    await runReplace([sibling, replaceBlock("SIBLING", "CHANGED")]);

    expect(
      await fs.pathExists(path.join(fixture.repo, "sibling-created.txt")),
    ).toBe(false);
    expect(
      await fs.pathExists(path.join(fixture.repo, "absolute-created.txt")),
    ).toBe(false);
    expect(
      await fs.pathExists(path.join(fixture.repo, "mcp-created.txt")),
    ).toBe(false);
    expect(
      await fs.pathExists(path.join(fixture.repo, "cli-created.txt")),
    ).toBe(false);
    expect(await fs.readFile(sibling, "utf-8")).toBe(originalSibling);
    expect(format).not.toHaveBeenCalled();
    expect(ensureDir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("rejects external file and ancestor symlinks in APIs, CLI, and MCP before mutation", async () => {
    const secret = path.join(fixture.outside, "secret.txt");
    const originalSecret = await fs.readFile(secret, "utf-8");
    const format = vi.spyOn(formatUtils, "formatFileInPlace");
    const ensureDir = vi.spyOn(fs, "ensureDir");
    const writeFile = vi.spyOn(fs, "writeFile");
    const externalFileLink = path.join(fixture.root, "external-file.txt");

    await expect(
      executeSafeReplace(
        { path: externalFileLink, blocks: [] },
        replaceBlock("EXTERNAL", "CHANGED"),
        context(),
      ),
    ).rejects.toThrow(/outside|denied/i);
    await expect(
      executeSafeReplace(
        {
          path: path.join(fixture.root, "external-dir", "secret.txt"),
          blocks: [],
        },
        replaceBlock("EXTERNAL", "CHANGED"),
        context(),
      ),
    ).rejects.toThrow(/outside|denied/i);

    const mcpWrite = await TOOL_REGISTRY.spekta_write.handler({
      path: "external-dir/mcp/new/file.txt",
      content: "escape",
    });
    expect(mcpWrite.isError).toBe(true);
    const mcpReplace = await TOOL_REGISTRY.spekta_replace.handler({
      path: externalFileLink,
      blocks: replaceBlock("EXTERNAL", "CHANGED"),
    });
    expect(mcpReplace.isError).toBe(true);

    await runWrite(["external-dir/cli/new/file.txt", "escape"]);
    await runReplace([externalFileLink, replaceBlock("EXTERNAL", "CHANGED")]);

    for (const ancestor of ["external-dir", "hop"]) {
      const missing = path.join(fixture.root, ancestor, "new", "deep");
      const writeTarget = path.join(missing, "created.txt");
      const replaceTarget = path.join(missing, "replace.txt");
      await expect(
        getWriteContent(writeTarget, "escape", context()),
      ).rejects.toThrow(/outside|denied/i);
      await expect(
        executeSafeReplace(
          { path: replaceTarget, blocks: [] },
          replaceBlock("missing", "changed"),
          context(),
        ),
      ).rejects.toThrow(/outside|denied/i);
      expect(await fs.pathExists(missing)).toBe(false);
    }

    expect(await fs.readFile(secret, "utf-8")).toBe(originalSecret);
    expect(await fs.pathExists(path.join(fixture.outside, "new"))).toBe(false);
    expect(format).not.toHaveBeenCalled();
    expect(ensureDir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("rejects dangling, cyclic, and non-directory ancestors without creating descendants", async () => {
    const format = vi.spyOn(formatUtils, "formatFileInPlace");
    const ensureDir = vi.spyOn(fs, "ensureDir");
    const writeFile = vi.spyOn(fs, "writeFile");
    for (const ancestor of ["dangling.txt", "cycle-a"]) {
      const target = path.join(fixture.root, ancestor, "nested", "created.txt");
      await expect(
        getWriteContent(target, "escape", context()),
      ).rejects.toThrow();
      expect(
        await fs.pathExists(path.join(fixture.root, ancestor, "nested")),
      ).toBe(false);
    }
    const nonDirectoryTarget = path.join(
      fixture.root,
      "real.txt",
      "child",
      "file.txt",
    );
    await expect(
      getWriteContent(nonDirectoryTarget, "invalid", context()),
    ).rejects.toThrow();
    expect(
      await fs.readFile(path.join(fixture.root, "real.txt"), "utf-8"),
    ).toContain("INTERNAL");
    expect(format).not.toHaveBeenCalled();
    expect(ensureDir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("allows an internal workspace through its symlink root and canonical spelling", async () => {
    process.chdir(fixture.alias);
    const aliasRoot = context(fixture.alias);
    const targets = [
      "relative.txt",
      path.join(fixture.alias, "alias-absolute.txt"),
      path.join(fixture.root, "canonical-absolute.txt"),
    ];

    for (const target of targets) {
      const result = await getWriteContent(target, "inside\n", aliasRoot);
      expect(result.success).toBe(true);
      expect(
        await fs.readFile(
          path.join(fixture.root, path.basename(target)),
          "utf-8",
        ),
      ).toBe("inside\n");
    }

    const nested = path.join(fixture.alias, "internal-dir", "created.txt");
    expect(
      (await getWriteContent(nested, "nested inside\n", aliasRoot)).success,
    ).toBe(true);
    expect(
      await fs.readFile(
        path.join(fixture.root, "safe", "created.txt"),
        "utf-8",
      ),
    ).toBe("nested inside\n");

    const replacementTargets = [
      "internal-file.txt",
      path.join(fixture.alias, "internal-file.txt"),
      path.join(fixture.root, "internal-file.txt"),
    ];
    for (const [index, target] of replacementTargets.entries()) {
      const marker = `INTERNAL_${index}`;
      const result = await executeSafeReplace(
        { path: target, blocks: [] },
        replaceBlock("INTERNAL", marker),
        aliasRoot,
      );
      expect(result.appliedCount).toBe(1);
    }
    expect(
      await fs.readFile(path.join(fixture.root, "real.txt"), "utf-8"),
    ).toContain("INTERNAL_2");
  });

  it("rejects a workspace root that is a file before any mutation", async () => {
    const format = vi.spyOn(formatUtils, "formatFileInPlace");
    const ensureDir = vi.spyOn(fs, "ensureDir");
    const writeFile = vi.spyOn(fs, "writeFile");
    const invalid = context(path.join(fixture.root, "real.txt"));

    await expect(
      getWriteContent("invalid-root.txt", "nope", invalid),
    ).rejects.toThrow(/workspace|directory/i);
    await expect(
      executeSafeReplace(
        { path: "real.txt", blocks: [] },
        replaceBlock("INTERNAL", "CHANGED"),
        invalid,
      ),
    ).rejects.toThrow(/workspace|directory/i);
    expect(
      await fs.pathExists(path.join(fixture.root, "invalid-root.txt")),
    ).toBe(false);
    expect(format).not.toHaveBeenCalled();
    expect(ensureDir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("applies ignore and restricted-path rules through canonical aliases and preserves whitelisted targets", async () => {
    const originalIgnored = await fs.readFile(
      path.join(fixture.root, "ignored.txt"),
      "utf-8",
    );
    const originalRestricted = await fs.readFile(
      path.join(fixture.root, ".env"),
      "utf-8",
    );
    const format = vi.spyOn(formatUtils, "formatFileInPlace");

    await expect(
      executeSafeReplace(
        { path: path.join(fixture.root, "ignored-alias.txt"), blocks: [] },
        replaceBlock("SPEKTA_IGNORED", "CHANGED"),
        context(),
      ),
    ).rejects.toThrow(/ignored/i);
    await expect(
      executeSafeReplace(
        { path: path.join(fixture.root, "alias.env.txt"), blocks: [] },
        replaceBlock("RESTRICTED_ENV", "CHANGED"),
        context(),
      ),
    ).rejects.toThrow(/restricted/i);

    const allowed = await executeSafeReplace(
      { path: path.join(fixture.root, "allowed.txt"), blocks: [] },
      replaceBlock("WHITELISTED", "STILL_ALLOWED"),
      context(),
    );
    expect(allowed.appliedCount).toBe(1);
    expect(
      await fs.readFile(path.join(fixture.root, "allowed.txt"), "utf-8"),
    ).toContain("STILL_ALLOWED");
    expect(
      await fs.readFile(path.join(fixture.root, "ignored.txt"), "utf-8"),
    ).toBe(originalIgnored);
    expect(await fs.readFile(path.join(fixture.root, ".env"), "utf-8")).toBe(
      originalRestricted,
    );
    expect(format).toHaveBeenCalledTimes(1);
  });

  it("uses explicit workspace policy for relative creation and canonical directory aliases", async () => {
    await fs.appendFile(
      path.join(fixture.root, ".spektaignore"),
      "canonical-blocked/\nrequested-blocked/\n",
    );
    await fs.ensureDir(path.join(fixture.root, "canonical-blocked"));
    await fs.ensureDir(path.join(fixture.root, "restricted", ".env"));
    await fs.symlink(
      path.join(fixture.root, "canonical-blocked"),
      path.join(fixture.root, "canonical-alias"),
      "dir",
    );
    await fs.symlink(
      path.join(fixture.root, "safe"),
      path.join(fixture.root, "requested-blocked"),
      "dir",
    );
    await fs.symlink(
      path.join(fixture.root, "restricted", ".env"),
      path.join(fixture.root, "restricted-alias"),
      "dir",
    );
    process.chdir(fixture.ambient);
    const aliasRoot = context(fixture.alias);
    const writes = vi.spyOn(fs, "writeFile");
    const directories = vi.spyOn(fs, "ensureDir");
    const format = vi.spyOn(formatUtils, "formatFileInPlace");

    for (const target of [
      "ignored.txt",
      "git-ignored.txt",
      "managed.txt",
      "global.txt",
      "canonical-alias/new/deep.md",
      "requested-blocked/new/deep.md",
      "restricted-alias/new/deep.md",
    ]) {
      await expect(
        getWriteContent(target, "denied", aliasRoot),
      ).rejects.toThrow(/ignored|restricted/);
    }
    expect(writes).not.toHaveBeenCalled();
    expect(directories).not.toHaveBeenCalled();
    expect(format).not.toHaveBeenCalled();

    expect(
      (await getWriteContent("..new.md", "eligible\n", aliasRoot)).success,
    ).toBe(true);
    expect(
      await fs.readFile(path.join(fixture.root, "..new.md"), "utf-8"),
    ).toBe("eligible\n");
    expect(await fs.pathExists(path.join(fixture.ambient, "..new.md"))).toBe(
      false,
    );
  });
});
