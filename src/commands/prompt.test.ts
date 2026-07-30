import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as config from "../core/config";
import * as ui from "../ui/ui";
import { runPromptRunner } from "./prompt";

vi.mock("../core/config", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    listPrompts: vi.fn(),
    renderPrompt: vi.fn(),
    getEnv: vi.fn().mockResolvedValue({}),
    getGlobalPromptContext: vi.fn().mockReturnValue({ id: "test-id" }),
  };
});

vi.mock("../ui/ui", () => ({
  searchableSelect: vi.fn(),
}));

vi.mock("fs-extra");

describe("runPromptRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prints message if no prompts exist", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(config.listPrompts).mockResolvedValue([]);

    await runPromptRunner();

    expect(consoleSpy).toHaveBeenCalledWith(
      "No custom or composable prompts found.",
    );
  });

  it("lists prompts and automatically saves prompt output to uncategorized path", async () => {
    vi.mocked(config.listPrompts).mockResolvedValue([
      {
        filename: "test.md",
        name: "Test Prompt",
        description: "Test Description",
      },
    ]);
    vi.mocked(config.renderPrompt).mockResolvedValue("Rendered content");
    vi.mocked(ui.searchableSelect).mockResolvedValueOnce("test.md");

    await runPromptRunner();

    expect(ui.searchableSelect).toHaveBeenCalledTimes(1);
    expect(config.renderPrompt).toHaveBeenCalledWith("test.md");
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("spekta/docs/uncategorized"),
      "Rendered content",
      "utf-8",
    );
  });
});
