import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPromptRunner } from "./prompt";
import * as config from "../core/config";
import * as ui from "../ui/ui";

vi.mock("../core/config", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    listPrompts: vi.fn(),
    renderPrompt: vi.fn(),
    getEnv: vi.fn().mockResolvedValue({}),
  };
});

vi.mock("../ui/ui", () => ({
  searchableSelect: vi.fn(),
}));

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

  it("lists prompts and prompts user for action selection", async () => {
    vi.mocked(config.listPrompts).mockResolvedValue([
      {
        filename: "test.md",
        name: "Test Prompt",
        description: "Test Description",
      },
    ]);
    vi.mocked(config.renderPrompt).mockResolvedValue("Rendered content");
    vi.mocked(ui.searchableSelect)
      .mockResolvedValueOnce("test.md")
      .mockResolvedValueOnce("save");

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runPromptRunner();

    expect(ui.searchableSelect).toHaveBeenCalledTimes(2);
    expect(config.renderPrompt).toHaveBeenCalledWith("test.md");
  });
});
