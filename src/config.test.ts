import fs from "fs-extra";
import os from "os";
import path from "path";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  bootstrap,
  getPromptContent,
  getProviders,
  HOME_DIR,
  HOME_IGNORE,
  HOME_PROMPTS,
  HOME_PROVIDERS_FREE,
  HOME_PROVIDERS_USER,
  HOME_TOOLS,
  loadToolDefinitions,
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

  it("should update all HOME_* paths when SPEKTA_HOME_OVERRIDE is set", () => {
    // Mock the environment variable
    vi.stubGlobal("process", {
      ...process,
      env: {
        ...process.env,
        SPEKTA_HOME_OVERRIDE: "/custom/home/path",
      },
    });

    // Call refreshPaths to update paths
    refreshPaths();

    // Verify all paths are updated correctly
    expect(HOME_DIR).toBe("/custom/home/path");
    expect(HOME_PROVIDERS_USER).toBe("/custom/home/path/providers.yaml");
    expect(HOME_PROVIDERS_FREE).toBe("/custom/home/path/providers-free.yaml");
    expect(HOME_PROMPTS).toBe("/custom/home/path/prompts");
    expect(HOME_IGNORE).toBe("/custom/home/path/.spektaignore");
    expect(HOME_TOOLS).toBe("/custom/home/path/tools");
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

describe("Tool definitions", () => {
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
    expect(HOME_TOOLS).toBe(original); // path changes but structure preserved
  });
});

describe("REPL Prompt Injection", () => {
  it("should replace {{DYNAMIC_TOOLS}} with tool documentation", async () => {
    const content = await getPromptContent("repl.md");
    expect(content).toContain("### Tools");
    expect(content).toContain("#### read");
    expect(content).not.toContain("{{DYNAMIC_TOOLS}}");
  });
});

describe("Tool Overrides", () => {
  const testHome = path.join(os.tmpdir(), "spekta-test-overrides");

  beforeAll(async () => {
    await fs.ensureDir(path.join(testHome, "tools"));
    process.env.SPEKTA_HOME_OVERRIDE = testHome;
    refreshPaths();
  });

  it("should prioritize user-defined tool descriptions", async () => {
    const overrideContent = `
name: read
description: "Custom Override Description"
params:
  paths:
    description: "Custom Param"
xml_example: "<read />"
`;
    await fs.writeFile(
      path.join(testHome, "tools", "read.yaml"),
      overrideContent,
    );

    const tools = await loadToolDefinitions();
    const readTool = tools.find((t) => t.name === "read");

    expect(readTool?.description).toBe("Custom Override Description");

    await fs.remove(testHome);
  });
});
