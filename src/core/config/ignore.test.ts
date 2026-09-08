import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { getIgnorePatterns } from "./ignore";
import { HOME_IGNORE, HOME_DEFAULT_IGNORE, refreshPaths } from "./paths";

describe("getIgnorePatterns", () => {
  const tempHome = path.join(os.tmpdir(), "spekta-ignore-home");
  const tempWorkspace = path.join(os.tmpdir(), "spekta-ignore-workspace");

  beforeEach(async () => {
    await fs.ensureDir(tempHome);
    await fs.ensureDir(tempWorkspace);
    process.env.SPEKTA_HOME_OVERRIDE = tempHome;
    refreshPaths();
    vi.spyOn(process, "cwd").mockReturnValue(tempWorkspace);
  });

  afterEach(async () => {
    await fs.remove(tempHome);
    await fs.remove(tempWorkspace);
    vi.restoreAllMocks();
  });

  it("should combine patterns from home and workspace directories in the correct order", async () => {
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

  it("should define the managed default ignore path correctly", () => {
    refreshPaths();
    expect(HOME_DEFAULT_IGNORE).toContain(".spektadefaultignore");
  });
});
