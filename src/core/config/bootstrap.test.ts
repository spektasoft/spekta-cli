import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedAssetFixtures } from "../config.test-fixtures";
import { bootstrap } from "./bootstrap";
import { getAssetPaths, HOME_DIR, refreshPaths } from "./paths";

describe("Bootstrap Logic", () => {
  const tempTestDir = path.join(os.tmpdir(), "spekta-tests");

  beforeEach(async () => {
    fs.ensureDirSync(tempTestDir);
    process.env.SPEKTA_HOME_OVERRIDE = tempTestDir;
    process.env.SPEKTA_ASSET_ROOT_OVERRIDE = tempTestDir;
    await seedAssetFixtures(tempTestDir);
    refreshPaths();
  });

  afterEach(() => {
    delete process.env.SPEKTA_HOME_OVERRIDE;
    delete process.env.SPEKTA_ASSET_ROOT_OVERRIDE;
    fs.removeSync(tempTestDir);
    refreshPaths();
  });

  it("should construct correct HOME_DIR path", () => {
    expect(HOME_DIR).toBe(tempTestDir);
  });

  it("should initialize user directories, ignore files, and seed default prompts", async () => {
    await bootstrap();
    expect(fs.existsSync(path.join(tempTestDir, "prompts"))).toBe(true);
    // Verify prompts from asset paths were seeded if present
    const ASSET_PROMPTS = getAssetPaths().ASSET_PROMPTS;
    if (await fs.pathExists(ASSET_PROMPTS)) {
      const assetFiles = await fs.readdir(ASSET_PROMPTS);
      for (const file of assetFiles) {
        if (file.endsWith(".md")) {
          expect(
            await fs.pathExists(path.join(tempTestDir, "prompts", file)),
          ).toBe(true);
        }
      }
    }
  });
});

describe("Bootstrap Logic - Dual Directory Structure", () => {
  const tempTestDir = path.join(os.tmpdir(), "spekta-bootstrap-flat-test");

  beforeEach(async () => {
    await fs.ensureDir(tempTestDir);
    process.env.SPEKTA_HOME_OVERRIDE = path.join(tempTestDir, "home");
    process.env.SPEKTA_ASSET_ROOT_OVERRIDE = path.join(tempTestDir, "assets");

    // Seed flat assets directly in asset root without templates/ parent folder
    await fs.ensureDir(path.join(tempTestDir, "assets", "tools"));
    await fs.ensureDir(path.join(tempTestDir, "assets", "prompts"));
    await fs.writeFile(
      path.join(tempTestDir, "assets", "prompts", "test-prompt.md"),
      "Test Content",
    );

    refreshPaths();
  });

  afterEach(async () => {
    delete process.env.SPEKTA_HOME_OVERRIDE;
    delete process.env.SPEKTA_ASSET_ROOT_OVERRIDE;
    await fs.remove(tempTestDir);
    refreshPaths();
  });

  it("should complete bootstrap without throwing when assets exist in flat layout", async () => {
    await expect(bootstrap()).resolves.not.toThrow();

    const seededPrompt = path.join(
      tempTestDir,
      "home",
      "prompts",
      "test-prompt.md",
    );
    expect(await fs.pathExists(seededPrompt)).toBe(true);
  });
});
