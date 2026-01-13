import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "path";
import fs from "fs-extra";
import os from "os";
import { bootstrap, getPromptContent, refreshPaths, HOME_DIR } from "./config";

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
      /Prompt template not found/
    );
  });
});
