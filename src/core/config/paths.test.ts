import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAssetPaths,
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
    const flatPrompts = path.join(tempDir, "prompts");
    await fs.ensureDir(flatTools);
    await fs.ensureDir(flatPrompts);

    process.env.SPEKTA_ASSET_ROOT_OVERRIDE = tempDir;
    const paths = getAssetPaths();

    expect(paths.ASSET_TOOLS).toBe(flatTools);
  });

  it("should default to nested path when neither nested nor flat subpath exists", () => {
    process.env.SPEKTA_ASSET_ROOT_OVERRIDE = tempDir;
    const paths = getAssetPaths();

    expect(paths.ASSET_TOOLS).toBe(path.join(tempDir, "templates", "tools"));
  });
});

describe("Asset Root Resolution & Paths", () => {
  let originalHomeOverride: string | undefined;

  beforeEach(() => {
    originalHomeOverride = process.env.SPEKTA_HOME_OVERRIDE;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalHomeOverride === undefined) {
      delete process.env.SPEKTA_HOME_OVERRIDE;
    } else {
      process.env.SPEKTA_HOME_OVERRIDE = originalHomeOverride;
    }
    refreshPaths();
  });

  it("HOME_TOOLS points to ~/.spekta/tools by default", () => {
    delete process.env.SPEKTA_HOME_OVERRIDE;
    refreshPaths();
    expect(HOME_TOOLS).toBe(path.join(os.homedir(), ".spekta", "tools"));
  });

  it("refreshPaths updates HOME_TOOLS correctly", () => {
    const originalOverride = process.env.SPEKTA_HOME_OVERRIDE;
    const original = HOME_TOOLS;
    const customDir = path.join(os.tmpdir(), "custom-home");
    process.env.SPEKTA_HOME_OVERRIDE = customDir;
    refreshPaths();
    expect(HOME_TOOLS).toBe(path.join(customDir, "tools"));

    if (originalOverride === undefined) {
      delete process.env.SPEKTA_HOME_OVERRIDE;
    } else {
      process.env.SPEKTA_HOME_OVERRIDE = originalOverride;
    }
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
        SPEKTA_HOME_OVERRIDE: path.join(os.tmpdir(), "custom-home-path"),
      },
    });

    refreshPaths();

    const customHome = path.join(os.tmpdir(), "custom-home-path");
    expect(HOME_DIR).toBe(customHome);
    expect(HOME_PROVIDERS_USER).toBe(path.join(customHome, "providers.yaml"));
    expect(HOME_PROVIDERS_FREE).toBe(
      path.join(customHome, "providers-free.yaml"),
    );
    expect(HOME_PROMPTS).toBe(path.join(customHome, "prompts"));
    expect(HOME_IGNORE).toBe(path.join(customHome, ".spektaignore"));
    expect(HOME_TOOLS).toBe(path.join(customHome, "tools"));
  });
});
