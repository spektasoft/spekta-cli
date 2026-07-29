import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { bootstrap } from "./bootstrap";
import { refreshPaths, HOME_DIR } from "./paths";
import { seedAssetFixtures } from "../config.test-fixtures";

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

  it("should create necessary directories on bootstrap", async () => {
    await bootstrap();
    expect(fs.existsSync(path.join(tempTestDir, "prompts"))).toBe(true);
  });
});
