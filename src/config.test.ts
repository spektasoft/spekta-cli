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
  getEnv,
  loadToolDefinitions,
  refreshPaths,
  resetInternalState,
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
    // Use a whitelist approach to cleaning process.env
    const keysToClean = ["SPEKTA_HOME_OVERRIDE"];
    keysToClean.forEach((key) => delete process.env[key]);

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
    // Use a whitelist approach to cleaning process.env
    const keysToClean = ["SPEKTA_HOME_OVERRIDE"];
    keysToClean.forEach((key) => delete process.env[key]);

    fs.removeSync(tempTestDir);
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

describe("Environment Loading", () => {
  const tempTestDir = path.join(os.tmpdir(), "spekta-env-test");
  const tempHome = path.join(os.tmpdir(), "spekta-env-home");
  const originalCwd = process.cwd;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetInternalState();
    await fs.ensureDir(tempTestDir);
    await fs.ensureDir(tempHome);
    process.env.SPEKTA_HOME_OVERRIDE = tempHome;
    process.cwd = () => tempTestDir;
  });

  afterEach(async () => {
    // Use a whitelist approach to cleaning process.env
    const keysToClean = [
      "TEST_VAR",
      "SPEKTA_HOME_OVERRIDE",
      "GLOBAL_ONLY",
      "LOCAL_ONLY",
      "SHARED",
      "TEST_GLOBAL_VAR",
      "TEST_LOCAL_VAR",
    ];
    keysToClean.forEach((key) => delete process.env[key]);

    process.cwd = originalCwd;
    await fs.remove(tempTestDir);
    await fs.remove(tempHome);
    resetInternalState();
  });

  it("should load global environment variables", async () => {
    await fs.writeFile(
      path.join(tempHome, ".env"),
      "TEST_GLOBAL_VAR=global_value",
    );

    await getEnv();

    expect(process.env.TEST_GLOBAL_VAR).toBe("global_value");
  });

  it("should prioritize Shell > Local > Global", async () => {
    // 1. Global value
    await fs.writeFile(path.join(tempHome, ".env"), "TEST_VAR=global");

    // 2. Local value
    await fs.writeFile(path.join(tempTestDir, ".env"), "TEST_VAR=local");

    // 3. Shell value (already set in process.env)
    process.env.TEST_VAR = "shell";

    await getEnv();

    expect(process.env.TEST_VAR).toBe("shell");

    // Reset and test Local > Global
    resetInternalState();
    delete process.env.TEST_VAR;

    await getEnv();
    expect(process.env.TEST_VAR).toBe("local");

    // Reset and test Global only
    resetInternalState();
    delete process.env.TEST_VAR;
    await fs.remove(path.join(tempTestDir, ".env"));

    await getEnv();
    expect(process.env.TEST_VAR).toBe("global");
  });

  it("should load both global and workspace variables when both exist", async () => {
    await fs.writeFile(
      path.join(tempHome, ".env"),
      "GLOBAL_ONLY=global_value\nSHARED=global",
    );

    await fs.writeFile(
      path.join(tempTestDir, ".env"),
      "LOCAL_ONLY=local_value\nSHARED=local",
    );

    await getEnv();

    expect(process.env.GLOBAL_ONLY).toBe("global_value");
    expect(process.env.LOCAL_ONLY).toBe("local_value");
    expect(process.env.SHARED).toBe("local"); // Local should override global
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
    expect(content).toContain("#### spekta_read");
    expect(content).not.toContain("{{DYNAMIC_TOOLS}}");
  });

  it("should not interpolate $ characters in tool descriptions", () => {
    const template = "Preamble\n{{DYNAMIC_TOOLS}}\nPostscript";
    const toolSections = "Tool with [10,$] range and `backticks` $` $& $'";

    // This replicates the logic in getPromptContent
    const result = template.replace(
      "{{DYNAMIC_TOOLS}}",
      () => `### Tools\n\n${toolSections}`,
    );

    expect(result).toContain("Tool with [10,$] range");
    expect(result).toContain("$` $& $'");
    expect(result).not.toContain("Preamble\nPreamble"); // Ensure $` didn't trigger
  });
});

describe("Tool Overrides", () => {
  const testHome = path.join(os.tmpdir(), "spekta-test-overrides");

  beforeEach(async () => {
    resetInternalState(); // Clears cachedTools and envLoaded
    await fs.ensureDir(path.join(testHome, "tools"));
    process.env.SPEKTA_HOME_OVERRIDE = testHome;
    refreshPaths();
  });

  afterEach(async () => {
    // Use a whitelist approach to cleaning process.env
    const keysToClean = ["SPEKTA_HOME_OVERRIDE"];
    keysToClean.forEach((key) => delete process.env[key]);

    await fs.remove(testHome);
  });

  it("should verify cache is cleared", async () => {
    await loadToolDefinitions();
    resetInternalState();
    // Subsequent calls should hit the filesystem again
    // rather than returning the previous ToolDefinition array reference.
    const tools1 = await loadToolDefinitions();
    resetInternalState();
    const tools2 = await loadToolDefinitions();
    expect(tools1).not.toBe(tools2);
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
  });
});
