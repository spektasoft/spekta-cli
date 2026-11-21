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
  it("rejects an external link before policy/content reads", async () => {
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
  it("checks spaced paths with either separator against ignore rules", async () => {
    await fs.ensureDir(path.join(fixture.root, "nested dir"));
    await fs.writeFile(
      path.join(fixture.root, "nested dir", "ignored file.txt"),
      "ignored",
    );
    await fs.appendFile(
      path.join(fixture.root, ".spektaignore"),
      "nested dir/ignored file.txt\n",
    );

    for (const target of [
      "nested dir/ignored file.txt",
      String.raw`nested dir\ignored file.txt`,
      path.join(fixture.root, "nested dir", "ignored file.txt"),
    ])
      await expect(
        isPathIgnored(target, undefined, fixture.root),
      ).resolves.toBe(true);
  });
  it.each([
    "ignored.txt",
    ...(process.platform === "win32" ? [] : ["ignored-alias.txt"]),
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
  it("allows an otherwise eligible Git-ignored read when requested", async () => {
    const workspace = await resolveWorkspace({ root: fixture.root });
    await expect(
      validateReadPathAccess("git-ignored.txt", workspace, {
        allowGitIgnored: true,
      }),
    ).resolves.toBe(path.join(fixture.root, "git-ignored.txt"));
  });
  it("checks restrictions and ignore policy across directory links", async () => {
    const managedDirectory = path.join(fixture.root, "managed-dir");
    await fs.ensureDir(managedDirectory);
    await fs.writeFile(path.join(managedDirectory, "real.txt"), "managed");
    await fs.symlink(
      managedDirectory,
      path.join(fixture.root, "managed-alias"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await fs.appendFile(
      path.join(fixture.root, ".spektaignore"),
      "managed-dir/real.txt\n",
    );

    const restrictedRoot = path.join(fixture.root, "restricted-dir");
    const restrictedNames = [".env", ".gitignore", ".spektaignore"];
    for (const name of restrictedNames)
      await fs.ensureDir(path.join(restrictedRoot, name));
    for (const name of restrictedNames) {
      const alias = path.join(fixture.root, `alias${name}.txt`);
      await fs.remove(alias);
      await fs.symlink(
        path.join(restrictedRoot, name),
        alias,
        process.platform === "win32" ? "junction" : "dir",
      );
    }

    const workspace = await resolveWorkspace({ root: fixture.root });
    await expect(
      validateReadPathAccess("managed-alias/real.txt", workspace),
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
    if (process.platform !== "win32")
      await fs.symlink(big, path.join(fixture.root, "big-alias.txt"));
    const workspace = await resolveWorkspace({ root: fixture.root });
    await expect(
      validateReadPathAccess("allowed.txt", workspace),
    ).resolves.toBe(path.join(fixture.root, "allowed.txt"));
    await expect(validateReadPathAccess("exact.txt", workspace)).resolves.toBe(
      exact,
    );
    for (const target of [
      "big.txt",
      ...(process.platform === "win32" ? [] : ["big-alias.txt"]),
    ])
      await expect(validateReadPathAccess(target, workspace)).rejects.toThrow(
        "size limit",
      );
  });
  it("requires exact workspace exceptions for sensitive paths", async () => {
    await fs.outputFile(
      path.join(fixture.root, "keys", "private.key"),
      "synthetic private fixture",
    );
    await fs.outputFile(
      path.join(fixture.root, "keys", "other.key"),
      "synthetic neighboring fixture",
    );
    const workspace = await resolveWorkspace({ root: fixture.root });

    await expect(
      validateReadPathAccess("keys/private.key", workspace),
    ).rejects.toThrow("restricted system file");

    await fs.appendFile(
      path.join(fixture.home, ".spektaignore"),
      "!keys/private.key\nallow-sensitive: keys/private.key\n",
    );
    await fs.appendFile(
      path.join(fixture.root, ".spektaignore"),
      "!keys/*.key\n",
    );
    await expect(
      validateReadPathAccess("keys/private.key", workspace),
    ).rejects.toThrow("restricted system file");

    await fs.appendFile(
      path.join(fixture.root, ".spektaignore"),
      "!keys/private.key\n",
    );
    await expect(
      validateReadPathAccess("keys/private.key", workspace),
    ).rejects.toThrow("restricted system file");

    await fs.appendFile(
      path.join(fixture.root, ".spektaignore"),
      "allow-sensitive: keys/private.key\n",
    );
    await expect(
      validateReadPathAccess("keys/private.key", workspace),
    ).resolves.toBe(path.join(fixture.root, "keys", "private.key"));
    await expect(
      validateReadPathAccess("keys/other.key", workspace),
    ).rejects.toThrow("restricted system file");

    await fs.appendFile(
      path.join(fixture.root, ".spektaignore"),
      "keys/private.key\n",
    );
    await expect(
      validateReadPathAccess("keys/private.key", workspace),
    ).rejects.toThrow("restricted system file");
  });

  it("uses the canonical sensitive target for an alias exception", async () => {
    if (process.platform === "win32") return;
    await fs.outputFile(
      path.join(fixture.root, "keys", "private.key"),
      "synthetic private fixture",
    );
    await fs.symlink(
      path.join(fixture.root, "keys", "private.key"),
      path.join(fixture.root, "key-alias.txt"),
    );
    const workspace = await resolveWorkspace({ root: fixture.root });
    await expect(
      validateReadPathAccess("key-alias.txt", workspace),
    ).rejects.toThrow("restricted system file");
    await fs.appendFile(
      path.join(fixture.root, ".spektaignore"),
      "!keys/private.key\n",
    );
    await expect(
      validateReadPathAccess("key-alias.txt", workspace),
    ).rejects.toThrow("restricted system file");
    await fs.appendFile(
      path.join(fixture.root, ".spektaignore"),
      "allow-sensitive: keys/private.key\n",
    );
    await expect(
      validateReadPathAccess("key-alias.txt", workspace),
    ).resolves.toBe(path.join(fixture.root, "keys", "private.key"));

    await fs.appendFile(
      path.join(fixture.root, ".spektaignore"),
      "key-alias.txt\n!key-alias.txt\n",
    );
    await expect(
      validateReadPathAccess("key-alias.txt", workspace),
    ).rejects.toThrow("restricted system file");
  });

  it("allows an explicitly excepted environment file while keeping examples eligible", async () => {
    await fs.outputFile(path.join(fixture.root, ".env.example"), "example");
    const workspace = await resolveWorkspace({ root: fixture.root });
    await expect(
      validateReadPathAccess(".env.example", workspace),
    ).resolves.toBe(path.join(fixture.root, ".env.example"));
    await fs.appendFile(
      path.join(fixture.root, ".spektaignore"),
      "allow-sensitive: .env\n",
    );
    await expect(validateReadPathAccess(".env", workspace)).resolves.toBe(
      path.join(fixture.root, ".env"),
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
