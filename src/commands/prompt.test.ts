import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as config from "../core/config";
import * as ui from "../ui/ui";
import { parsePromptArgs, runPromptRunner } from "./prompt";

vi.mock("../core/config", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  listPrompts: vi.fn(),
  renderPrompt: vi.fn(),
  resolvePrompt: vi.fn(),
  getEnv: vi.fn().mockResolvedValue({}),
  getGlobalPromptContext: vi.fn().mockReturnValue({ id: "test-id" }),
}));
vi.mock("../ui/ui", () => ({ searchableSelect: vi.fn() }));
vi.mock("fs-extra");

describe("prompt CLI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.pathExists).mockResolvedValue(false);
  });

  it("parses supported arguments", () => {
    expect(
      parsePromptArgs(["review.md", "--stdout", "--output", "out.md"]),
    ).toEqual({ selector: "review.md", stdout: true, output: "out.md" });
    expect(parsePromptArgs([])).toEqual({
      selector: undefined,
      stdout: false,
      output: undefined,
    });
  });
  it.each([["--unknown"], ["--output"]])("rejects invalid options", (arg) =>
    expect(() => parsePromptArgs([arg])).toThrow(),
  );
  it("rejects multiple selectors", () =>
    expect(() => parsePromptArgs(["a.md", "b.md"])).toThrow());

  it("preserves interactive selection with no arguments", async () => {
    const prompt = { filename: "test.md", name: "Test", description: "desc" };
    vi.mocked(config.listPrompts).mockResolvedValue([prompt]);
    vi.mocked(config.renderPrompt).mockResolvedValue("Rendered");
    vi.mocked(ui.searchableSelect).mockResolvedValue("test.md");
    await runPromptRunner();
    expect(ui.searchableSelect).toHaveBeenCalledTimes(1);
  });

  it.each([["test.md"], ["Test Prompt"]])(
    "bypasses interactive selection for %s",
    async (selector) => {
      const prompt = {
        filename: "test.md",
        name: "Test Prompt",
        description: "desc",
      };
      vi.mocked(config.listPrompts).mockResolvedValue([prompt]);
      vi.mocked(config.resolvePrompt).mockResolvedValue(prompt);
      vi.mocked(config.renderPrompt).mockResolvedValue("Rendered");
      await runPromptRunner([selector]);
      expect(ui.searchableSelect).not.toHaveBeenCalled();
    },
  );

  it("fails unknown selectors", async () => {
    vi.mocked(config.listPrompts).mockResolvedValue([
      { filename: "test.md", name: "Test", description: "desc" },
    ]);
    vi.mocked(config.resolvePrompt).mockRejectedValue(
      new Error("unknown selector"),
    );
    await expect(runPromptRunner(["missing.md"])).rejects.toThrow(
      "unknown selector",
    );
  });

  it("writes explicit output", async () => {
    const prompt = {
      filename: "test.md",
      name: "Test",
      description: "desc",
      default_output: "default.md",
    };
    vi.mocked(config.listPrompts).mockResolvedValue([prompt]);
    vi.mocked(config.resolvePrompt).mockResolvedValue(prompt);
    vi.mocked(config.renderPrompt).mockResolvedValue("Rendered content");
    await runPromptRunner(["Test", "--output", "nested/a.md"]);
    expect(fs.ensureDir).toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("nested/a.md"),
      "Rendered content",
      "utf-8",
    );
  });

  it("writes rendered content to stdout without persisting or opening an editor", async () => {
    const prompt = {
      filename: "test.md",
      name: "Test",
      description: "desc",
      default_output: "default.md",
    };
    vi.mocked(config.listPrompts).mockResolvedValue([prompt]);
    vi.mocked(config.resolvePrompt).mockResolvedValue(prompt);
    vi.mocked(config.renderPrompt).mockResolvedValue("Rendered content");
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    await runPromptRunner(["Test", "--stdout"]);
    expect(stdout).toHaveBeenCalledWith("Rendered content");
    expect(fs.ensureDir).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(config.getEnv).not.toHaveBeenCalled();
    stdout.mockRestore();
  });

  it("uses the uncategorized fallback when no default output exists", async () => {
    const prompt = { filename: "test.md", name: "Test", description: "desc" };
    vi.mocked(config.listPrompts).mockResolvedValue([prompt]);
    vi.mocked(config.resolvePrompt).mockResolvedValue(prompt);
    vi.mocked(config.renderPrompt).mockResolvedValue("Rendered");
    await runPromptRunner(["Test"]);
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("spekta/docs/uncategorized"),
      "Rendered",
      "utf-8",
    );
  });
});
