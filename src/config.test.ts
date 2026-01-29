import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bootstrap,
  getPromptContent,
  getProviders,
  HOME_DIR,
  HOME_PROVIDERS_FREE,
  HOME_PROVIDERS_USER,
  refreshPaths,
} from "./config";
import { writeYaml } from "./utils/yaml";

describe("Config & Prompt Resolution", () => {
  const tempTestDir = path.join(os.tmpdir(), "spekta-tests");

  beforeEach(() => {
    fs.ensureDirSync(tempTestDir);
    process.env.SPEKTA_HOME_OVERRIDE = tempTestDir;
    refreshPaths();
  });

  afterEach(() => {
    fs.removeSync(tempTestDir);
    delete process.env.SPEKTA_HOME_OVERRIDE;
    refreshPaths();
  });

  it("should construct correct HOME_DIR path", () => {
    expect(HOME_DIR).toBe(tempTestDir);
  });

  it("should create necessary directories on bootstrap", async () => {
    await bootstrap();
    expect(fs.existsSync(path.join(tempTestDir, "prompts"))).toBe(true);
  });

  it("should resolve prompt from user home directory if it exists", async () => {
    await bootstrap();
    const fileName = "test-prompt.md";
    const userPromptPath = path.join(tempTestDir, "prompts", fileName);
    const mockContent = "User Override Content";

    fs.writeFileSync(userPromptPath, mockContent);

    const content = await getPromptContent(fileName);
    expect(content).toBe(mockContent);
  });

  it("should throw error if prompt exists in neither location", async () => {
    await expect(getPromptContent("non-existent.md")).rejects.toThrow(
      /Prompt template not found/,
    );
  });

  it("should update provider paths when refreshPaths is called", () => {
    const originalProviderPath = HOME_PROVIDERS_USER;
    const customDir = path.join(os.tmpdir(), "manual-override");

    process.env.SPEKTA_HOME_OVERRIDE = customDir;
    refreshPaths();

    expect(HOME_PROVIDERS_USER).toBe(path.join(customDir, "providers.yaml"));
    expect(HOME_PROVIDERS_USER).not.toBe(originalProviderPath);

    // Cleanup
    delete process.env.SPEKTA_HOME_OVERRIDE;
    refreshPaths();
  });
});

describe("Provider Merging Logic", () => {
  const tempTestDir = path.join(os.tmpdir(), "spekta-providers-test");

  beforeEach(() => {
    fs.ensureDirSync(tempTestDir);
    process.env.SPEKTA_HOME_OVERRIDE = tempTestDir;
    refreshPaths();
  });

  afterEach(() => {
    fs.removeSync(tempTestDir);
    delete process.env.SPEKTA_HOME_OVERRIDE;
    refreshPaths();
  });

  it("preserves duplicate model IDs with user providers first", async () => {
    // Mock user providers with one overlapping model
    const mockUser = {
      providers: [{ name: "User Model", model: "test/model" }],
    };
    const mockFree = {
      providers: [
        { name: "[Free] Free Model", model: "test/model" },
        { name: "[Free] Unique", model: "unique/free" },
      ],
    };

    await writeYaml(HOME_PROVIDERS_USER, mockUser);
    await writeYaml(HOME_PROVIDERS_FREE, mockFree);

    const result = await getProviders();

    expect(result.providers).toHaveLength(3);
    expect(result.providers[0].name).toBe("User Model"); // User first
    expect(result.providers[1].name).toBe("[Free] Free Model");
    expect(result.providers[2].name).toBe("[Free] Unique");
  });
});
