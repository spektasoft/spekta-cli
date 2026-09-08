import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { getIgnorePatterns } from "./ignore";
import { getAssetPaths, HOME_IGNORE, refreshPaths } from "./paths";

describe("getIgnorePatterns", () => {
  const tempHome = path.join(os.tmpdir(), "spekta-ignore-home");
  const tempWorkspace = path.join(os.tmpdir(), "spekta-ignore-workspace");

  beforeEach(async () => {
    await fs.ensureDir(tempHome);
    await fs.ensureDir(tempWorkspace);
    process.env.SPEKTA_HOME_OVERRIDE = tempHome;
    process.env.SPEKTA_ASSET_ROOT_OVERRIDE = tempHome;
    refreshPaths();
    vi.spyOn(process, "cwd").mockReturnValue(tempWorkspace);
  });

  afterEach(async () => {
    await fs.remove(tempHome);
    await fs.remove(tempWorkspace);
    delete process.env.SPEKTA_HOME_OVERRIDE;
    delete process.env.SPEKTA_ASSET_ROOT_OVERRIDE;
    vi.restoreAllMocks();
  });

  it("should combine patterns from home and workspace directories in the correct order", async () => {
    await fs.writeFile(
      path.join(tempHome, "default.ignore"),
      "default-pattern\n",
    );
    await fs.writeFile(
      path.join(tempHome, ".spektadefaultignore"),
      "stale-pattern\n",
    );
    await fs.writeFile(
      HOME_IGNORE,
      "home-pattern-1\n# comment\nhome-pattern-2",
    );
    await fs.writeFile(
      path.join(tempWorkspace, ".spektaignore"),
      "work-pattern-1\nwork-pattern-2",
    );

    const patterns = await getIgnorePatterns();
    expect(patterns).toEqual([
      "default-pattern",
      "home-pattern-1",
      "home-pattern-2",
      "work-pattern-1",
      "work-pattern-2",
    ]);
  });

  it("should return only home patterns if workspace ignore is missing", async () => {
    await fs.writeFile(HOME_IGNORE, "home-pattern-1");
    await fs.remove(path.join(tempWorkspace, ".spektaignore"));

    const patterns = await getIgnorePatterns();
    expect(patterns).toEqual(["home-pattern-1"]);
  });

  it("should return only workspace patterns if home ignore is missing", async () => {
    await fs.remove(HOME_IGNORE);
    await fs.writeFile(
      path.join(tempWorkspace, ".spektaignore"),
      "work-pattern-1",
    );

    const patterns = await getIgnorePatterns();
    expect(patterns).toEqual(["work-pattern-1"]);
  });

  it("should return empty array if neither exists", async () => {
    await fs.remove(HOME_IGNORE);
    await fs.remove(path.join(tempWorkspace, ".spektaignore"));

    const patterns = await getIgnorePatterns();
    expect(patterns).toEqual([]);
  });

  it("uses the packaged default asset instead of a stale home file", async () => {
    await fs.writeFile(
      path.join(tempHome, "default.ignore"),
      "default-pattern\n",
    );
    await fs.writeFile(
      path.join(tempHome, ".spektadefaultignore"),
      "stale-pattern\n",
    );
    expect(getAssetPaths().ASSET_DEFAULT_IGNORE).toBe(
      path.join(tempHome, "default.ignore"),
    );
    expect(await getIgnorePatterns()).toEqual(["default-pattern"]);
  });
});
