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
