import { describe, it, expect, vi, beforeEach } from "vitest";
import { runReview } from "./review";
import fs from "fs-extra";
import * as prompts from "@inquirer/prompts";
import * as config from "../config";
import * as git from "../git";
import * as fsManager from "../fs-manager";
import * as ui from "../ui";
import * as orchestrator from "../orchestrator";

vi.mock("fs-extra");
vi.mock("@inquirer/prompts");
vi.mock("../config");
vi.mock("../git");
vi.mock("../fs-manager");
vi.mock("../ui");
vi.mock("../orchestrator");

describe("runReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default resolve for common git calls
    vi.mocked(git.resolveHash).mockImplementation(async (ref) => ref);
    vi.mocked(git.getNearestMerge).mockResolvedValue("base-sha");
  });

  it("generates a prompt file for initial review when 'Only Prompt' is selected", async () => {
    vi.mocked(config.getProviders).mockResolvedValue({
      providers: [{ name: "GPT-4", model: "gpt-4" }],
    });
    vi.mocked(config.getPromptContent).mockResolvedValue(
      "MOCK_TEMPLATE_CONTENT"
    );
    vi.mocked(config.getIgnorePatterns).mockResolvedValue([]);
    vi.mocked(config.getEnv).mockResolvedValue({});

    // Mock UI prompt for provider selection
    vi.mocked(ui.promptProviderSelection).mockResolvedValue({
      isOnlyPrompt: true,
    });

    // Mock review directory and metadata
    vi.mocked(fsManager.getReviewDir).mockResolvedValue({
      dir: "/mock/dir",
      id: "202401011200",
    });
    vi.mocked(fsManager.getNextReviewMetadata).mockResolvedValue({
      nextNum: 1,
      lastFile: null,
    });
    vi.mocked(git.getGitDiff).mockResolvedValue("MOCK_DIFF");

    // Mock isInitial selection
    vi.mocked(prompts.select).mockResolvedValueOnce(true);

    // Mock getHashRange (uses suggested range)
    vi.mocked(prompts.confirm).mockResolvedValueOnce(true);

    await runReview();

    const expectedPath = "/mock/dir/r-001-base-sh..HEAD.md";
    expect(fs.writeFile).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining("MOCK_TEMPLATE_CONTENT")
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining("GIT DIFF:\n````markdown\nMOCK_DIFF\n````")
    );
  });

  it("throws an error if the AI call fails", async () => {
    vi.mocked(config.getProviders).mockResolvedValue({
      providers: [{ name: "GPT-4", model: "gpt-4" }],
    });
    vi.mocked(config.getEnv).mockResolvedValue({ OPENROUTER_API_KEY: "key" });

    // Mock UI provider selection
    vi.mocked(ui.promptProviderSelection).mockResolvedValue({
      isOnlyPrompt: false,
      provider: { name: "GPT-4", model: "gpt-4" },
    });

    // Mock isInitial selection
    vi.mocked(prompts.select).mockResolvedValueOnce(true);

    // Mock other required calls
    vi.mocked(git.getNearestMerge).mockResolvedValue("base-sha");
    vi.mocked(fsManager.getReviewDir).mockResolvedValue({
      dir: "/mock/dir",
      id: "202401011200",
    });
    vi.mocked(fsManager.getNextReviewMetadata).mockResolvedValue({
      nextNum: 1,
      lastFile: null,
    });
    vi.mocked(git.getGitDiff).mockResolvedValue("DIFF");
    vi.mocked(config.getPromptContent).mockResolvedValue("TEMPLATE");
    vi.mocked(prompts.confirm).mockResolvedValueOnce(true);

    // Mock orchestrator to throw
    vi.mocked(orchestrator.executeAiAction).mockRejectedValue(
      new Error("API Timeout")
    );

    await expect(runReview()).resolves.toBe(undefined);
  });
});
