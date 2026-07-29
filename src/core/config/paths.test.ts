import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAssetPaths,
  HOME_DEFAULT_IGNORE,
  HOME_DIR,
  HOME_IGNORE,
  HOME_PROMPTS,
  HOME_PROVIDERS_FREE,
  HOME_PROVIDERS_USER,
  HOME_TOOLS,
  refreshPaths,
} from "./paths";

describe("Asset Root Resolution & Dual Path Layouts", () => {
  const tempDir = path.join(os.tmpdir(), "spekta-path-tests");

  beforeEach(async () => {
    await fs.ensureDir(tempDir);
    process.env.SPEKTA_ASSET_ROOT_OVERRIDE = tempDir;
    refreshPaths();
  });

  afterEach(async () => {
    delete process.env.SPEKTA_ASSET_ROOT_OVERRIDE;
    await fs.remove(tempDir);
    refreshPaths();
  });

  it("should resolve nested asset paths when templates subfolder exists", async () => {
    const nestedTools = path.join(tempDir, "templates", "tools");
    await fs.ensureDir(nestedTools);

    const paths = getAssetPaths();
    expect(paths.ASSET_TOOLS).toBe(nestedTools);
  });

  it("should resolve flat asset paths when assets exist directly at root without templates subfolder", async () => {
    const flatTools = path.join(tempDir, "tools");
    await fs.ensureDir(flatTools);

    const paths = getAssetPaths();
    expect(paths.ASSET_TOOLS).toBe(flatTools);
  });
});

describe("Asset Root Resolution & Paths", () => {
  it("should resolve correct default ignore path on refresh", () => {
    refreshPaths();
    expect(HOME_DEFAULT_IGNORE).toContain(".spektadefaultignore");
  });

  it("HOME_TOOLS points to ~/.spekta/tools by default", () => {
    expect(HOME_TOOLS).toContain(".spekta/tools");
  });

  it("refreshPaths updates HOME_TOOLS correctly", () => {
    const original = HOME_TOOLS;
    process.env.SPEKTA_HOME_OVERRIDE = "/custom/path";
    refreshPaths();
    expect(HOME_TOOLS).toBe("/custom/path/tools");
    delete process.env.SPEKTA_HOME_OVERRIDE;
    refreshPaths();
    expect(HOME_TOOLS).toBe(original);
  });

  it("should update provider paths when refreshPaths is called", () => {
    const originalProviderPath = HOME_PROVIDERS_USER;
    const customDir = path.join(os.tmpdir(), "manual-override");

    process.env.SPEKTA_HOME_OVERRIDE = customDir;
    refreshPaths();

    expect(HOME_PROVIDERS_USER).toBe(path.join(customDir, "providers.yaml"));
    expect(HOME_PROVIDERS_USER).not.toBe(originalProviderPath);

    delete process.env.SPEKTA_HOME_OVERRIDE;
    refreshPaths();
  });

  it("should update all HOME_* paths when SPEKTA_HOME_OVERRIDE is set", () => {
    vi.stubGlobal("process", {
      ...process,
      env: {
        ...process.env,
        SPEKTA_HOME_OVERRIDE: "/custom/home/path",
      },
    });

    refreshPaths();

    expect(HOME_DIR).toBe("/custom/home/path");
    expect(HOME_PROVIDERS_USER).toBe("/custom/home/path/providers.yaml");
    expect(HOME_PROVIDERS_FREE).toBe("/custom/home/path/providers-free.yaml");
    expect(HOME_PROMPTS).toBe("/custom/home/path/prompts");
    expect(HOME_IGNORE).toBe("/custom/home/path/.spektaignore");
    expect(HOME_TOOLS).toBe("/custom/home/path/tools");
  });
});
