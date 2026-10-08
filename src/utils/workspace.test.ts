import fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../__tests__/workspace-fixture";
import {
  isPathWithin,
  resolveWorkspace,
  resolveWorkspaceMutationTarget,
  resolveWorkspaceTarget,
} from "./workspace";

let fixture: WorkspaceFixture;
beforeEach(async () => {
  fixture = await createWorkspaceFixture();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.cleanup();
});

describe("workspace containment", () => {
  it("uses path segments rather than string prefixes", () => {
    expect(isPathWithin(fixture.root, fixture.root)).toBe(true);
    expect(isPathWithin(fixture.root, path.join(fixture.root, "..notes"))).toBe(
      true,
    );
    expect(isPathWithin(fixture.root, `${fixture.root}-other/file.txt`)).toBe(
      false,
    );
    expect(isPathWithin(fixture.root, path.dirname(fixture.root))).toBe(false);
  });
  it.each([
    "real.txt",
    "..notes",
    "internal-file.txt",
    "internal-dir/child.txt",
    ".",
  ])("accepts eligible target %s", async (target) => {
    const workspace = await resolveWorkspace({ root: fixture.root });
    expect(
      (await resolveWorkspaceTarget(target, workspace)).canonicalPath,
    ).toBe(await fs.realpath(path.join(fixture.root, target)));
  });
  it.each([
    "../sibling.txt",
    "external-file.txt",
    "external-dir/secret.txt",
    "hop/secret.txt",
    "hop/missing/deeper.txt",
  ])("rejects escaping target %s", async (target) => {
    await expect(
      resolveWorkspaceTarget(
        target,
        await resolveWorkspace({ root: fixture.root }),
      ),
    ).rejects.toThrow("outside the project directory");
  });
  it("rejects absolute and prefix siblings before target lookup", async () => {
    const workspace = await resolveWorkspace({ root: fixture.root });
    const lookup = vi.spyOn(fs, "realpath");
    for (const target of [
      path.join(fixture.outside, "secret.txt"),
      `${fixture.root}-other/file.txt`,
    ])
      await expect(resolveWorkspaceTarget(target, workspace)).rejects.toThrow(
        "outside",
      );
    expect(lookup).not.toHaveBeenCalled();
  });
  it("canonicalizes symlinked workspaces and accepts either absolute spelling", async () => {
    const workspace = await resolveWorkspace({ root: fixture.alias });
    expect(workspace.canonicalRoot).toBe(await fs.realpath(fixture.root));
    for (const target of [
      "real.txt",
      path.join(fixture.alias, "real.txt"),
      path.join(fixture.root, "real.txt"),
    ])
      expect(
        (await resolveWorkspaceTarget(target, workspace)).canonicalPath,
      ).toBe(path.join(fixture.root, "real.txt"));
  });
  it.each(["missing/deep.txt", "dangling.txt", "cycle-a", "real.txt/child"])(
    "fails closed for unresolved target %s",
    async (target) => {
      await expect(
        resolveWorkspaceTarget(
          target,
          await resolveWorkspace({ root: fixture.root }),
        ),
      ).rejects.toThrow();
    },
  );
  it.each(["missing-root", "real.txt"])(
    "rejects invalid root %s",
    async (root) => {
      await expect(
        resolveWorkspace({ root: path.join(fixture.root, root) }),
      ).rejects.toThrow();
    },
  );
  it("uses invocation cwd and resolves relative roots", async () => {
    process.chdir(fixture.root);
    expect(await resolveWorkspace()).toEqual({
      root: fixture.root,
      canonicalRoot: fixture.root,
    });
    expect(await resolveWorkspace({ root: "." })).toEqual({
      root: fixture.root,
      canonicalRoot: fixture.root,
    });
  });
  it("propagates canonical and ancestor lookup failures", async () => {
    const workspace = await resolveWorkspace({ root: fixture.root });
    const canonical = Object.assign(new Error("canonical lookup denied"), {
      code: "EACCES",
    });
    vi.spyOn(fs, "realpath").mockRejectedValueOnce(canonical);
    await expect(resolveWorkspaceTarget("real.txt", workspace)).rejects.toBe(
      canonical,
    );
    vi.restoreAllMocks();
    const ancestor = Object.assign(new Error("ancestor lookup denied"), {
      code: "EACCES",
    });
    vi.spyOn(fs, "lstat").mockRejectedValueOnce(ancestor);
    await expect(resolveWorkspaceTarget("missing.txt", workspace)).rejects.toBe(
      ancestor,
    );
  });
});

describe("workspace mutation containment", () => {
  it.each(["real.txt", "internal-file.txt", "internal-dir/child.txt", "."])(
    "accepts existing internal target %s",
    async (target) => {
      const workspace = await resolveWorkspace({ root: fixture.root });
      const resolved = await resolveWorkspaceMutationTarget(target, workspace);
      expect(resolved.absolutePath).toBe(path.resolve(fixture.root, target));
      expect(resolved.canonicalPath).toBe(
        await fs.realpath(path.resolve(fixture.root, target)),
      );
    },
  );

  it("accepts existing and missing targets through a symlinked workspace root", async () => {
    const workspace = await resolveWorkspace({ root: fixture.alias });
    const canonicalFile = path.join(fixture.root, "real.txt");
    expect(
      (
        await resolveWorkspaceMutationTarget(
          path.join(fixture.root, "real.txt"),
          workspace,
        )
      ).canonicalPath,
    ).toBe(canonicalFile);
    expect(
      (await resolveWorkspaceMutationTarget("nested/new.txt", workspace, true))
        .canonicalPath,
    ).toBe(path.join(fixture.root, "nested/new.txt"));
  });

  it("accepts supported nested creation from an existing internal directory", async () => {
    const workspace = await resolveWorkspace({ root: fixture.root });
    expect(
      (
        await resolveWorkspaceMutationTarget(
          "safe/new/deeper.txt",
          workspace,
          true,
        )
      ).canonicalPath,
    ).toBe(path.join(fixture.root, "safe/new/deeper.txt"));
  });

  it.each([
    "../sibling.txt",
    "external-file.txt",
    "external-dir/secret.txt",
    "hop/secret.txt",
    "hop/missing/deeper.txt",
    "external-dir/reenter/real.txt",
    "external-dir/reenter/new/deeper.txt",
  ])("rejects mutation target with escaping ancestry: %s", async (target) => {
    await fs.symlink(
      fixture.root,
      path.join(fixture.outside, "reenter"),
      "dir",
    );
    const workspace = await resolveWorkspace({ root: fixture.root });
    await expect(
      resolveWorkspaceMutationTarget(target, workspace, true),
    ).rejects.toThrow("outside the project directory");
  });

  it("rejects an absolute repository sibling outside the effective workspace", async () => {
    const workspace = await resolveWorkspace({ root: fixture.root });
    await expect(
      resolveWorkspaceMutationTarget(
        path.join(fixture.repo, "sibling.txt"),
        workspace,
        true,
      ),
    ).rejects.toThrow("outside the project directory");
  });

  it.each([
    "dangling.txt",
    "cycle-a",
    "cycle-b",
    "real.txt/child",
    "external-file.txt/child",
  ])(
    "fails closed for unresolved or non-directory target %s",
    async (target) => {
      await expect(
        resolveWorkspaceMutationTarget(
          target,
          await resolveWorkspace({ root: fixture.root }),
          true,
        ),
      ).rejects.toThrow();
    },
  );

  it("rejects missing paths unless allowMissing is enabled", async () => {
    const workspace = await resolveWorkspace({ root: fixture.root });
    await expect(
      resolveWorkspaceMutationTarget("new/deep/file.txt", workspace),
    ).rejects.toThrow("does not exist");
    await expect(
      resolveWorkspaceMutationTarget("new/deep/file.txt", workspace, true),
    ).resolves.toMatchObject({
      canonicalPath: path.join(fixture.root, "new/deep/file.txt"),
    });
  });

  it("rejects absolute sibling paths before filesystem lookup", async () => {
    const workspace = await resolveWorkspace({ root: fixture.root });
    const lookup = vi.spyOn(fs, "lstat");
    await expect(
      resolveWorkspaceMutationTarget(
        path.join(fixture.outside, "secret.txt"),
        workspace,
        true,
      ),
    ).rejects.toThrow("outside");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("propagates ancestor lookup failures instead of treating them as missing", async () => {
    const workspace = await resolveWorkspace({ root: fixture.root });
    const denied = Object.assign(new Error("ancestor lookup denied"), {
      code: "EACCES",
    });
    vi.spyOn(fs, "lstat").mockRejectedValueOnce(denied);
    await expect(
      resolveWorkspaceMutationTarget("missing.txt", workspace, true),
    ).rejects.toBe(denied);
  });
});
