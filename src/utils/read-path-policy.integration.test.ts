import fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../__tests__/workspace-fixture";
import { getIgnorePatterns } from "../core/config";
import { assertPathNotIgnored, isPathIgnored } from "./path-ignore";
import { validateReadPathAccess } from "./security";
import { resolveWorkspace } from "./workspace";

let fixture: WorkspaceFixture;
beforeEach(async () => {
  fixture = await createWorkspaceFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.cleanup();
});
const SIZE = 10 * 1024 * 1024;

describe("workspace read policy", () => {
  it("rejects an external file link before policy/content reads", async () => {
    const workspace = await resolveWorkspace({ root: fixture.root });
    const reads = vi.spyOn(fs, "readFile");
    const stats = vi.spyOn(fs, "stat");
    await expect(
      validateReadPathAccess("external-file.txt", workspace),
    ).rejects.toThrow("outside");
    expect(reads).not.toHaveBeenCalled();
    expect(stats).not.toHaveBeenCalled();
  });
  it("uses explicit workspace ignore sources and Git cwd", async () => {
    process.chdir(fixture.ambient);
    expect(await getIgnorePatterns(fixture.root)).toEqual([
      "managed.txt",
      "global.txt",
      "ignored.txt",
      "!allowed.txt",
    ]);
    expect(await isPathIgnored("real.txt", undefined, fixture.root)).toBe(
      false,
    );
    expect(
      await isPathIgnored("git-ignored.txt", undefined, fixture.root),
    ).toBe(true);
    expect(await isPathIgnored("..notes", undefined, fixture.root)).toBe(false);
    await expect(
      assertPathNotIgnored("ignored.txt", "original.txt", {}, fixture.root),
    ).rejects.toThrow("original.txt is ignored");
  });
  it.each([
    "ignored.txt",
    "ignored-alias.txt",
    "git-ignored.txt",
    "managed.txt",
    "global.txt",
  ])("retains ignore policy for %s", async (target) => {
    await expect(
      validateReadPathAccess(
        target,
        await resolveWorkspace({ root: fixture.root }),
      ),
    ).rejects.toThrow("ignored");
  });
  it("checks restrictions and ignore policy across aliases", async () => {
    await fs.symlink(
      path.join(fixture.root, "real.txt"),
      path.join(fixture.root, "managed-alias.txt"),
    );
    await fs.appendFile(
      path.join(fixture.root, ".spektaignore"),
      "managed-alias.txt\n",
    );
    const workspace = await resolveWorkspace({ root: fixture.root });
    await expect(
      validateReadPathAccess("managed-alias.txt", workspace),
    ).rejects.toThrow("ignored");
    for (const target of [
      ".env",
      ".gitignore",
      ".spektaignore",
      "alias.env.txt",
      "alias.gitignore.txt",
      "alias.spektaignore.txt",
    ])
      await expect(validateReadPathAccess(target, workspace)).rejects.toThrow(
        "restricted system file",
      );
  });
  it("preserves whitelist and file size policy", async () => {
    const exact = path.join(fixture.root, "exact.txt"),
      big = path.join(fixture.root, "big.txt");
    for (const [file, size] of [
      [exact, SIZE],
      [big, SIZE + 1],
    ] as const) {
      const handle = await fs.open(file, "w");
      try {
        await fs.ftruncate(handle, size);
      } finally {
        await fs.close(handle);
      }
    }
    await fs.symlink(big, path.join(fixture.root, "big-alias.txt"));
    const workspace = await resolveWorkspace({ root: fixture.root });
    await expect(
      validateReadPathAccess("allowed.txt", workspace),
    ).resolves.toBe(path.join(fixture.root, "allowed.txt"));
    await expect(validateReadPathAccess("exact.txt", workspace)).resolves.toBe(
      exact,
    );
    for (const target of ["big.txt", "big-alias.txt"])
      await expect(validateReadPathAccess(target, workspace)).rejects.toThrow(
        "size limit",
      );
  });
  it("validates canonical absolute inputs to a symlinked workspace", async () => {
    await expect(
      validateReadPathAccess(
        path.join(fixture.root, "real.txt"),
        await resolveWorkspace({ root: fixture.alias }),
      ),
    ).resolves.toBe(path.join(fixture.root, "real.txt"));
  });
});
