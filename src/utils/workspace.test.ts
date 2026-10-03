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
