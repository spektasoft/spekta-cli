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

  it("uses the orchestrator for AI execution", async () => {
    // Mock config
    vi.mocked(config.getProviders).mockResolvedValue({
      providers: [{ name: "test", model: "test-model" }],
    });
    vi.mocked(config.getEnv).mockResolvedValue({
      OPENROUTER_API_KEY: "test-key",
    });
    vi.mocked(config.getIgnorePatterns).mockResolvedValue([]);
    vi.mocked(config.getPromptContent).mockResolvedValue("Test Template");

    // Mock UI provider selection
    vi.mocked(ui.promptProviderSelection).mockResolvedValue({
      isOnlyPrompt: false,
      provider: { name: "test", model: "test-model" },
    });

    // Mock git operations
    vi.mocked(git.getNearestMerge).mockResolvedValue("base-sha");
    vi.mocked(git.getGitDiff).mockResolvedValue("GIT DIFF CONTENT");

    // Mock FS manager
    vi.mocked(fsManager.getReviewDir).mockResolvedValue({
      dir: "/mock/dir",
      id: "202401011200",
    });
    vi.mocked(fsManager.getNextReviewMetadata).mockResolvedValue({
      nextNum: 1,
      lastFile: null,
    });

    // Mock isInitial selection (direct select call in review.ts)
    vi.mocked(prompts.select).mockResolvedValueOnce(true);

    // Mock getHashRange internal prompts
    vi.mocked(prompts.confirm).mockResolvedValueOnce(true);

    // Mock orchestrator
    vi.mocked(orchestrator.executeAiAction).mockResolvedValue("AI result");

    await runReview();

    expect(orchestrator.executeAiAction).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("GIT DIFF:"),
      })
    );
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

  it("calls AI with merged context during a validation review", async () => {
    vi.mocked(config.getProviders).mockResolvedValue({
      providers: [{ name: "GPT-4", model: "gpt-4" }],
    });
    vi.mocked(config.getPromptContent).mockResolvedValue("VALIDATION_TEMPLATE");
    vi.mocked(config.getEnv).mockResolvedValue({
      OPENROUTER_API_KEY: "sk-test",
    });

    // Mock isInitial = false
    vi.mocked(prompts.select).mockResolvedValueOnce(false);

    // Mock folder selection
    vi.mocked(prompts.select).mockResolvedValueOnce("202401011200");

    // Mock getHashRange - useSuggested = false
    vi.mocked(prompts.confirm).mockResolvedValueOnce(false);

    // Mock hash inputs
    vi.mocked(prompts.input)
      .mockResolvedValueOnce("abcdef1")
      .mockResolvedValueOnce("abcdef2");

    // Mock UI provider selection
    vi.mocked(ui.promptProviderSelection).mockResolvedValue({
      isOnlyPrompt: false,
      provider: { name: "GPT-4", model: "gpt-4", config: { temp: 0.7 } },
    });

    // Mock orchestrator
    vi.mocked(orchestrator.executeAiAction).mockResolvedValue(
      "AI_RESPONSE_CONTENT"
    );

    // Mock FS Manager
    vi.mocked(fsManager.listReviewFolders).mockResolvedValue(["202401011200"]);
    vi.mocked(fsManager.getReviewDir).mockResolvedValue({
      dir: "/mock/dir",
      id: "202401011200",
    });
    vi.mocked(fsManager.getNextReviewMetadata).mockResolvedValue({
      nextNum: 2,
      lastFile: "r-001-aaaaaaa..bbbbbbb.md",
    });
    vi.mocked(fsManager.getHashesFromReviewFile).mockReturnValue({
      start: "aaaaaaa",
      end: "bbbbbbb",
    });

    // Mock Git
    vi.mocked(git.getGitDiff).mockResolvedValue("NEW_DIFF");
    vi.mocked(git.resolveHash).mockImplementation(async (ref) => ref);

    // Mock file reading
    vi.mocked(fs.readFile).mockImplementation((() =>
      Promise.resolve("previous review content")) as any);

    await runReview();

    // Verify Orchestrator was called with correct parameters
    expect(orchestrator.executeAiAction).toHaveBeenCalledWith({
      apiKey: "sk-test",
      provider: { name: "GPT-4", model: "gpt-4", config: { temp: 0.7 } },
      prompt: expect.stringContaining("PREVIOUS REVIEW:"),
      spinnerTitle: expect.stringContaining("AI is reviewing"),
    });

    // Verify File Writing with sliced hashes
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/mock/dir/r-002-abcdef1..abcdef2.md",
      "AI_RESPONSE_CONTENT"
    );
  });

  it("logs an error and exits if OPENROUTER_API_KEY is missing when calling AI", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(config.getProviders).mockResolvedValue({
      providers: [{ name: "GPT-4", model: "gpt-4" }],
    });
    vi.mocked(config.getEnv).mockResolvedValue({ OPENROUTER_API_KEY: "" });

    // Mock UI provider selection (non-prompt)
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

    await runReview();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Missing OPENROUTER_API_KEY")
    );
    expect(orchestrator.executeAiAction).not.toHaveBeenCalled();
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

  it("should handle the full review flow", async () => {
    // 1. Mock Config Data
    const mockProvider = {
      name: "Model Name",
      model: "model-id",
      config: { temperature: 0.7 },
    };

    vi.mocked(config.getProviders).mockResolvedValue({
      providers: [mockProvider],
    });

    vi.mocked(config.getEnv).mockResolvedValue({
      OPENROUTER_API_KEY: "test-key",
    });

    vi.mocked(config.getIgnorePatterns).mockResolvedValue(["node_modules"]);
    vi.mocked(config.getPromptContent).mockResolvedValue(
      "Test Prompt Template"
    );

    // 2. Mock FS Manager Data
    vi.mocked(fsManager.listReviewFolders).mockResolvedValue(["202401011200"]);
    vi.mocked(fsManager.getReviewDir).mockResolvedValue({
      dir: "/mock/dir/202401011200",
      id: "202401011200",
    });
    vi.mocked(fsManager.getNextReviewMetadata).mockResolvedValue({
      nextNum: 2,
      lastFile: "r-001-abc..def.md",
    });
    vi.mocked(fsManager.getHashesFromReviewFile).mockReturnValue({
      start: "abc1234",
      end: "def5678",
    });

    // 3. Mock Prompt Interactions
    // First select: isInitial?
    vi.mocked(prompts.select).mockResolvedValueOnce(false);

    // select: folderId?
    vi.mocked(prompts.select).mockResolvedValueOnce("202401011200");

    // Inside getHashRange - confirm: useSuggested?
    vi.mocked(prompts.confirm).mockResolvedValueOnce(true);

    // Mock UI provider selection
    vi.mocked(ui.promptProviderSelection).mockResolvedValue({
      isOnlyPrompt: false,
      provider: mockProvider,
    });

    // 4. Mock Git and Logic Side-Effects
    vi.mocked(git.resolveHash).mockImplementation(async (ref) => `full-${ref}`);
    vi.mocked(git.getGitDiff).mockResolvedValue("fake diff content");

    vi.mocked(fs.readFile).mockImplementation((() =>
      Promise.resolve("previous review content")) as any);

    // Mock orchestrator
    vi.mocked(orchestrator.executeAiAction).mockResolvedValue(
      "AI Review Result"
    );

    // 5. Execute
    await runReview();

    // 6. Assertions
    expect(orchestrator.executeAiAction).toHaveBeenCalledWith({
      apiKey: "test-key",
      provider: mockProvider,
      prompt: expect.stringContaining("GIT DIFF:"),
      spinnerTitle: expect.stringContaining("AI is reviewing"),
    });

    expect(orchestrator.executeAiAction).toHaveBeenCalledWith({
      apiKey: "test-key",
      provider: mockProvider,
      prompt: expect.stringContaining("fake diff content"),
      spinnerTitle: expect.any(String),
    });

    // Verify file write (r-002 because nextNum was 2)
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("r-002-"),
      "AI Review Result"
    );
  });
});
