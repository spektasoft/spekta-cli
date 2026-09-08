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

  it("should initialize user directories and ignore files without seeding default prompts into prompts directory", async () => {
    await bootstrap();
    expect(fs.existsSync(tempTestDir)).toBe(true);
    expect(fs.existsSync(path.join(tempTestDir, "prompts"))).toBe(true);
    // Verify default prompts are NOT seeded into HOME_PROMPTS
    const assetPrompts = getAssetPaths().ASSET_PROMPTS;
    if (await fs.pathExists(assetPrompts)) {
      const assetFiles = await fs.readdir(assetPrompts);
      for (const file of assetFiles) {
        expect(
          await fs.pathExists(path.join(tempTestDir, "prompts", file)),
        ).toBe(false);
      }
    }
  });
});

describe("Bootstrap Logic - Asset Discovery Integration", () => {
  const tempTestDir = path.join(os.tmpdir(), "spekta-bootstrap-discovery-test");

  beforeEach(async () => {
    await fs.emptyDir(tempTestDir);
    process.env.SPEKTA_HOME_OVERRIDE = path.join(tempTestDir, ".spekta");
    process.env.SPEKTA_ASSET_ROOT_OVERRIDE = tempTestDir;
    refreshPaths();
  });

  afterEach(async () => {
    delete process.env.SPEKTA_HOME_OVERRIDE;
    delete process.env.SPEKTA_ASSET_ROOT_OVERRIDE;
    await fs.remove(tempTestDir);
  });

  it("should complete bootstrap successfully when nested template assets exist", async () => {
    await fs.ensureDir(path.join(tempTestDir, "templates", "tools"));
    await fs.ensureDir(path.join(tempTestDir, "templates", "prompts"));
    await fs.writeFile(
      path.join(tempTestDir, "templates", "default.ignore"),
      "# Default ignore\n",
    );

    await expect(bootstrap()).resolves.not.toThrow();
  });

  it("should throw a clear error when asset tools directory is missing", async () => {
    await expect(bootstrap()).rejects.toThrow(
      /Critical Error: Internal tool templates not found at/,
    );
  });
});
