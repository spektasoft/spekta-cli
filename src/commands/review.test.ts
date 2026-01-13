import { describe, it, expect, vi, beforeEach } from "vitest";
import { runReview } from "./review";
import fs from "fs-extra";
import * as prompts from "@inquirer/prompts";
import * as config from "../config";
import * as git from "../git";
import * as fsManager from "../fs-manager";
import * as api from "../api";

vi.mock("fs-extra");
vi.mock("@inquirer/prompts");
vi.mock("../config");
vi.mock("../git");
vi.mock("../fs-manager");
vi.mock("../api");
vi.mock("ora", () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  })),
}));

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

    // Prompts sequence:
    // 1. isInitial confirm -> true
    // 2. useSuggested confirm -> false
    // 3. input old -> "old-sha"
    // 4. input new -> "new-sha"
    // 5. select provider -> Only Prompt
    vi.mocked(prompts.confirm)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    vi.mocked(prompts.input)
      .mockResolvedValueOnce("old-sha")
      .mockResolvedValueOnce("new-sha");
    vi.mocked(prompts.select).mockResolvedValue({ isOnlyPrompt: true });

    vi.mocked(fsManager.getReviewDir).mockResolvedValue({
      dir: "/mock/dir",
      id: "202401011200",
    });
    vi.mocked(fsManager.getNextReviewMetadata).mockResolvedValue({
      nextNum: 1,
      lastFile: null,
    });
    vi.mocked(git.getGitDiff).mockResolvedValue("MOCK_DIFF");

    await runReview();

    const expectedPath = "/mock/dir/r-001-old-sha..new-sha.md";
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

    // 1. confirm: isInitial? -> false
    // 2. select: folderId? -> "202401011200"
    // 3. confirm: useSuggested range? -> false
    // 4. select: provider? -> GPT-4 (Note: runReview calls getHashRange BEFORE select provider)
    vi.mocked(prompts.confirm)
      .mockResolvedValueOnce(false) // isInitial
      .mockResolvedValueOnce(false); // useSuggested (in getHashRange)

    vi.mocked(prompts.select)
      .mockResolvedValueOnce("202401011200") // Folder selection
      .mockResolvedValueOnce({
        isOnlyPrompt: false,
        provider: { name: "GPT-4", model: "gpt-4", config: { temp: 0.7 } },
      }); // Provider selection

    // 5. input: Older hash? -> "sha1abc" (must be valid hex for regex if used elsewhere)
    // 6. input: Newer hash? -> "sha2abc"
    vi.mocked(prompts.input)
      .mockResolvedValueOnce("abcdef1")
      .mockResolvedValueOnce("abcdef2");

    vi.mocked(fsManager.listReviewFolders).mockResolvedValue(["202401011200"]);
    vi.mocked(fsManager.getReviewDir).mockResolvedValue({
      dir: "/mock/dir",
      id: "202401011200",
    });

    // CRITICAL: Use valid hex in filename so getHashesFromReviewFile succeeds
    vi.mocked(fsManager.getNextReviewMetadata).mockResolvedValue({
      nextNum: 2,
      lastFile: "r-001-aaaaaaa..bbbbbbb.md",
    });

    // MOCK ADDED HERE: Ensure getHashesFromReviewFile returns a value to prevent extra prompt
    vi.mocked(fsManager.getHashesFromReviewFile).mockReturnValue({
      start: "aaaaaaa",
      end: "bbbbbbb",
    });
    // @ts-ignore
    vi.mocked(fs.readFile).mockResolvedValue("CONTENT_OF_PREVIOUS_REVIEW");
    vi.mocked(git.getGitDiff).mockResolvedValue("NEW_DIFF");
    vi.mocked(api.callAI).mockResolvedValue("AI_RESPONSE_CONTENT");

    await runReview();

    // Verify Prompt Construction
    expect(api.callAI).toHaveBeenCalledWith(
      "sk-test",
      "gpt-4",
      expect.stringContaining("PREVIOUS REVIEW:"),
      { temp: 0.7 }
    );

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

    vi.mocked(prompts.confirm).mockResolvedValue(true);
    vi.mocked(prompts.select).mockResolvedValue({
      isOnlyPrompt: false,
      provider: { name: "GPT-4", model: "gpt-4" },
    });

    await runReview();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Missing OPENROUTER_API_KEY")
    );
    expect(api.callAI).not.toHaveBeenCalled();
  });

  it("throws an error if the AI call fails", async () => {
    vi.mocked(config.getProviders).mockResolvedValue({
      providers: [{ name: "GPT-4", model: "gpt-4" }],
    });
    vi.mocked(config.getEnv).mockResolvedValue({ OPENROUTER_API_KEY: "key" });
    vi.mocked(prompts.confirm).mockResolvedValue(true);
    vi.mocked(prompts.select).mockResolvedValue({
      isOnlyPrompt: false,
      provider: { name: "GPT-4", model: "gpt-4" },
    });

    vi.mocked(api.callAI).mockRejectedValue(new Error("API Timeout"));

    await expect(runReview()).rejects.toThrow("API Timeout");
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

    // 3. Mock Prompt Interactions in order of execution
    // First confirm: isInitial?
    vi.mocked(prompts.confirm).mockResolvedValueOnce(false);

    // select: folderId?
    vi.mocked(prompts.select).mockResolvedValueOnce("202401011200");

    // Inside getHashRange - confirm: useSuggested?
    vi.mocked(prompts.confirm).mockResolvedValueOnce(true);

    // select: provider selection?
    vi.mocked(prompts.select).mockResolvedValueOnce({
      isOnlyPrompt: false,
      provider: mockProvider,
    });

    // 4. Mock Git and Logic Side-Effects
    vi.mocked(git.resolveHash).mockImplementation(async (ref) => `full-${ref}`);
    vi.mocked(git.getGitDiff).mockResolvedValue("fake diff content");

    // @ts-ignore
    vi.mocked(fs.readFile).mockResolvedValue("previous review content");
    vi.mocked(api.callAI).mockResolvedValue("AI Review Result");

    // 5. Execute
    await runReview();

    // 6. Assertions
    expect(api.callAI).toHaveBeenCalledWith(
      "test-key",
      "model-id",
      expect.stringContaining("GIT DIFF:"),
      { temperature: 0.7 }
    );

    expect(api.callAI).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.stringContaining("fake diff content"),
      expect.any(Object)
    );

    // Verify file write (r-002 because nextNum was 2)
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("r-002-"),
      "AI Review Result"
    );
  });
});
