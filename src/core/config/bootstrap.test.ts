import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedAssetFixtures } from "../config.test-fixtures";
import { bootstrap } from "./bootstrap";
import { getAssetPaths, HOME_DIR, refreshPaths } from "./paths";
import { resetInternalState } from "./env";

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
    expect(fs.existsSync(path.join(tempTestDir, ".spektadefaultignore"))).toBe(
      false,
    );
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

  it("should not create user home state in read-only mode", async () => {
    const readOnlyHome = path.join(tempTestDir, "home");
    process.env.SPEKTA_HOME_OVERRIDE = readOnlyHome;
    refreshPaths();

    await bootstrap({ writeUserHome: false });

    expect(fs.existsSync(readOnlyHome)).toBe(false);
  });

  it("loads configuration from the explicit launch root while cwd points elsewhere", async () => {
    const launchRoot = path.join(tempTestDir, "launch");
    const changedRoot = path.join(tempTestDir, "changed");
    const previousLimit = process.env.SPEKTA_READ_TOKEN_LIMIT;
    const previousHome = process.env.SPEKTA_HOME_OVERRIDE;
    const launchHome = path.join(tempTestDir, "launch-home");
    await fs.ensureDir(launchRoot);
    await fs.ensureDir(changedRoot);
    await fs.writeFile(
      path.join(launchRoot, ".env"),
      `SPEKTA_READ_TOKEN_LIMIT=123\nSPEKTA_HOME_OVERRIDE=${launchHome}\n`,
    );
    await fs.writeFile(
      path.join(changedRoot, ".env"),
      `SPEKTA_READ_TOKEN_LIMIT=987\nSPEKTA_HOME_OVERRIDE=${path.join(tempTestDir, "wrong-home")}\n`,
    );
    delete process.env.SPEKTA_READ_TOKEN_LIMIT;
    delete process.env.SPEKTA_HOME_OVERRIDE;
    resetInternalState();
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(changedRoot);
    try {
      await bootstrap({ workspaceRoot: launchRoot });
      expect(process.env.SPEKTA_READ_TOKEN_LIMIT).toBe("123");
      expect(HOME_DIR).toBe(launchHome);
      expect(await fs.pathExists(path.join(launchHome, "prompts"))).toBe(true);
      expect(await fs.pathExists(path.join(tempTestDir, "wrong-home"))).toBe(
        false,
      );
    } finally {
      cwd.mockRestore();
      if (previousLimit === undefined)
        delete process.env.SPEKTA_READ_TOKEN_LIMIT;
      else process.env.SPEKTA_READ_TOKEN_LIMIT = previousLimit;
      if (previousHome === undefined) delete process.env.SPEKTA_HOME_OVERRIDE;
      else process.env.SPEKTA_HOME_OVERRIDE = previousHome;
      resetInternalState();
      refreshPaths();
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

  it("should validate assets in read-only mode", async () => {
    await expect(bootstrap({ writeUserHome: false })).rejects.toThrow(
      /Critical Error: Internal tool templates not found at/,
    );
  });
});
