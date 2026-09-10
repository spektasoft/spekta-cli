import { describe, expect, it, afterEach } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { getPromptContent, listPrompts, renderPrompt } from "./prompts";
import { resolveSelectedPartials } from "./partials";
import { refreshPaths } from "./paths";
import { resetInternalState } from "./env";
import { generateId } from "../../fs/fs-manager";
import { seedAssetFixtures } from "../config.test-fixtures";
import { bootstrap } from "./bootstrap";

describe("Partial selection", () => {
  it("includes all partials when nothing is explicitly selected", () => {
    expect(
      resolveSelectedPartials(["a.md", "b.md"], { include: [], exclude: [] }),
    ).toEqual(["a.md", "b.md"]);
  });

  it("includes only explicitly included partials", () => {
    expect(
      resolveSelectedPartials(["a.md", "b.md", "c.md"], {
        include: ["a.md", "c.md"],
        exclude: [],
      }),
    ).toEqual(["a.md", "c.md"]);
  });

  it("excludes explicitly excluded partials", () => {
    expect(
      resolveSelectedPartials(["a.md", "b.md", "c.md"], {
        include: [],
        exclude: ["b.md"],
      }),
    ).toEqual(["a.md", "c.md"]);
  });

  it("gives exclusion precedence over inclusion", () => {
    expect(
      resolveSelectedPartials(["a.md", "b.md"], {
        include: ["a.md", "b.md"],
        exclude: ["b.md"],
      }),
    ).toEqual(["a.md"]);
  });
});

describe("Prompts, REPL Injection & Placeholders", () => {
  const setupTempPrompt = async (content: string, filename: string) => {
    const tempDir = path.join(os.tmpdir(), `spekta-test-${generateId()}`);
    await fs.ensureDir(path.join(tempDir, "prompts"));
    process.env.SPEKTA_HOME_OVERRIDE = tempDir;
    process.env.SPEKTA_ASSET_ROOT_OVERRIDE = tempDir;
    await seedAssetFixtures(tempDir);
    refreshPaths();
    await fs.writeFile(path.join(tempDir, "prompts", filename), content);
    return tempDir;
  };

  afterEach(() => {
    delete process.env.SPEKTA_HOME_OVERRIDE;
    delete process.env.SPEKTA_ASSET_ROOT_OVERRIDE;
    refreshPaths();
  });

  it("should resolve prompt from user home directory if it exists", async () => {
    const tempTestDir = path.join(os.tmpdir(), "spekta-tests-prompt");
    fs.ensureDirSync(tempTestDir);
    process.env.SPEKTA_HOME_OVERRIDE = tempTestDir;
    process.env.SPEKTA_ASSET_ROOT_OVERRIDE = tempTestDir;
    await seedAssetFixtures(tempTestDir);
    refreshPaths();

    await bootstrap();
    const fileName = "test-prompt.md";
    const userPromptPath = path.join(tempTestDir, "prompts", fileName);
    const mockContent = "User Override Content";

    fs.writeFileSync(userPromptPath, mockContent);

    const content = await getPromptContent(fileName);
    expect(content).toBe(mockContent);

    fs.removeSync(tempTestDir);
  });

  it("should throw error if prompt exists in neither location", async () => {
    await expect(getPromptContent("non-existent.md")).rejects.toThrow(
      "Prompt file not found: non-existent.md",
    );
  });

  it("should replace {{ tools }} with tool documentation", async () => {
    const tempTestDir = path.join(os.tmpdir(), "spekta-repl-dyn-test");
    fs.ensureDirSync(path.join(tempTestDir, "prompts"));
    process.env.SPEKTA_HOME_OVERRIDE = tempTestDir;
    process.env.SPEKTA_ASSET_ROOT_OVERRIDE = tempTestDir;
    await seedAssetFixtures(tempTestDir);
    refreshPaths();

    try {
      const content = await getPromptContent("repl.md");
      expect(content).toContain("### Tools");
      expect(content).toContain("#### spekta_read");
      expect(content).not.toContain("{{DYNAMIC_TOOLS}}");
    } finally {
      fs.removeSync(tempTestDir);
    }
  });

  it("should not interpolate $ characters in tool descriptions during prompt resolution", async () => {
    const tempTestDir = path.join(os.tmpdir(), "spekta-repl-dollar-test");
    fs.ensureDirSync(path.join(tempTestDir, "prompts"));
    process.env.SPEKTA_HOME_OVERRIDE = tempTestDir;
    process.env.SPEKTA_ASSET_ROOT_OVERRIDE = tempTestDir;
    await seedAssetFixtures(tempTestDir);
    refreshPaths();

    const mockTools = [
      {
        name: "test_tool",
        description: "Tool with [10,$] range and `backticks` $` $& $'",
        params: {},
        xml_example: "<test/>",
      },
    ];

    try {
      const content = await getPromptContent("repl.md", async () => mockTools);
      expect(content).toContain("Tool with [10,$] range");
      expect(content).toContain("$` $& $'");
      const occurrences = content.split("### Tools").length - 1;
      expect(occurrences).toBe(1);
    } finally {
      fs.removeSync(tempTestDir);
    }
  });

  it("should replace {{ tools }} in user-defined repl.md prompt", async () => {
    const tempTestDir = path.join(os.tmpdir(), "spekta-repl-test");
    fs.ensureDirSync(path.join(tempTestDir, "prompts"));
    process.env.SPEKTA_HOME_OVERRIDE = tempTestDir;
    process.env.SPEKTA_ASSET_ROOT_OVERRIDE = tempTestDir;
    await seedAssetFixtures(tempTestDir);
    refreshPaths();

    const userPromptPath = path.join(tempTestDir, "prompts", "repl.md");
    const mockContent = "Custom REPL Prompt\n{{ tools }}";
    fs.writeFileSync(userPromptPath, mockContent);

    try {
      const content = await getPromptContent("repl.md");
      expect(content).toContain("Custom REPL Prompt");
      expect(content).toContain("### Tools");
      expect(content).toContain("#### spekta_read");
      expect(content).not.toContain("{{DYNAMIC_TOOLS}}");
    } finally {
      fs.removeSync(tempTestDir);
    }
  });

  it("should list prompts including bootstrapped defaults with valid frontmatter", async () => {
    const tempHome = path.join(os.tmpdir(), `spekta-test-${Date.now()}`);
    process.env.SPEKTA_HOME_OVERRIDE = tempHome;
    resetInternalState();
    await bootstrap();

    const prompts = await listPrompts();
    expect(prompts.length).toBeGreaterThan(0);
    const hasDefault = prompts.some(
      (p) => p.filename === "plan.md" || p.filename === "commit.md",
    );
    expect(hasDefault).toBe(true);

    await fs.remove(tempHome);
  });

  it("should exclude prompts in partials directory and prompts missing name or description", async () => {
    const tempDir = path.join(os.tmpdir(), `spekta-test-${generateId()}`);
    await fs.ensureDir(path.join(tempDir, "prompts", "partials"));
    process.env.SPEKTA_HOME_OVERRIDE = tempDir;
    process.env.SPEKTA_ASSET_ROOT_OVERRIDE = tempDir;
    refreshPaths();

    // Partial file
    await fs.writeFile(
      path.join(tempDir, "prompts", "partials", "partial.md"),
      "---\nname: Partial\ndescription: Subtemplate\n---\nPartial content",
    );
    // Non-frontmatter file
    await fs.writeFile(
      path.join(tempDir, "prompts", "no-meta.md"),
      "Raw markdown without frontmatter",
    );
    // Valid prompt
    await fs.writeFile(
      path.join(tempDir, "prompts", "valid.md"),
      "---\nname: Valid Prompt\ndescription: A valid prompt\n---\nBody text",
    );

    const prompts = await listPrompts();
    expect(prompts.some((p) => p.filename === "partial.md")).toBe(false);
    expect(prompts.some((p) => p.filename === "no-meta.md")).toBe(false);
    expect(prompts.some((p) => p.filename === "valid.md")).toBe(true);
  });

  it("should render a prompt template with custom context via Nunjucks", async () => {
    const tempHome = path.join(os.tmpdir(), `spekta-test-${Date.now()}`);
    process.env.SPEKTA_HOME_OVERRIDE = tempHome;
    resetInternalState();
    await bootstrap();

    const customPromptPath = path.join(tempHome, "prompts", "test.md");
    await fs.outputFile(
      customPromptPath,
      "---\nname: Test Prompt\ndescription: A test prompt\n---\nHello {{ name }}! {% if includeExtra %}Extra: {{ extra }}{% endif %}",
    );

    const rendered = await renderPrompt("test.md", {
      name: "World",
      includeExtra: true,
      extra: "123",
    });
    expect(rendered.trim()).toBe("Hello World! Extra: 123");

    await fs.remove(tempHome);
  });

  it("should render templates using Nunjucks and safe global context", async () => {
    const tempTestDir = path.join(os.tmpdir(), "spekta-nunjucks-ctx-test");
    fs.ensureDirSync(path.join(tempTestDir, "prompts"));
    process.env.SPEKTA_HOME_OVERRIDE = tempTestDir;
    process.env.SPEKTA_ASSET_ROOT_OVERRIDE = tempTestDir;
    await seedAssetFixtures(tempTestDir);
    refreshPaths();

    const promptPath = path.join(tempTestDir, "prompts", "ctx-test.md");
    await fs.writeFile(
      promptPath,
      "---\nname: Context Test\n---\nCWD: {{ cwd }}\nTime: {{ timestamp }}",
    );

    const result = await renderPrompt("ctx-test.md");
    expect(result).toContain("CWD: ");
    expect(result).toContain("Time: ");

    fs.removeSync(tempTestDir);
  });
});
