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
  });

  it("generates a prompt file for initial review when 'Only Prompt' is selected", async () => {
    // Mock Config
    vi.mocked(config.getProviders).mockResolvedValue({
      providers: [{ name: "GPT-4", model: "gpt-4" }],
    });
    vi.mocked(config.getPromptContent).mockReturnValue("MOCK_TEMPLATE_CONTENT");
    vi.mocked(config.getIgnorePatterns).mockReturnValue([]);
    vi.mocked(config.getEnv).mockReturnValue({});

    // Mock Prompts
    vi.mocked(prompts.input)
      .mockResolvedValueOnce("old-sha")
      .mockResolvedValueOnce("new-sha");
    vi.mocked(prompts.confirm).mockResolvedValue(true); // isInitial
    vi.mocked(prompts.select).mockResolvedValue({ isOnlyPrompt: true });

    // Mock FS Logic
    vi.mocked(fsManager.getReviewDir).mockReturnValue({
      dir: "/mock/dir",
      id: "202401011200",
    });
    vi.mocked(fsManager.getNextReviewMetadata).mockReturnValue({
      nextNum: 1,
      lastFile: null,
    });
    vi.mocked(git.getGitDiff).mockReturnValue("MOCK_DIFF");

    await runReview();

    const expectedPath = "/mock/dir/r-001-old-sha..new-sha.md";
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining("MOCK_TEMPLATE_CONTENT")
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expectedPath,
      expect.stringContaining("GIT DIFF:\n````markdown\nMOCK_DIFF\n````")
    );
  });

  it("calls AI with merged context during a validation review", async () => {
    vi.mocked(config.getProviders).mockResolvedValue({
      providers: [{ name: "GPT-4", model: "gpt-4" }],
    });
    vi.mocked(config.getPromptContent).mockReturnValue("VALIDATION_TEMPLATE");
    vi.mocked(config.getEnv).mockReturnValue({ OPENROUTER_API_KEY: "sk-test" });

    // Prompts: Validation flow
    vi.mocked(prompts.input)
      .mockResolvedValueOnce("sha1")
      .mockResolvedValueOnce("sha2")
      .mockResolvedValueOnce("202401011200"); // folderId
    vi.mocked(prompts.confirm).mockResolvedValue(false); // isInitial = false
    vi.mocked(prompts.select).mockResolvedValue({
      isOnlyPrompt: false,
      provider: { name: "GPT-4", model: "gpt-4", config: { temp: 0.7 } },
    });

    vi.mocked(fsManager.getReviewDir).mockReturnValue({
      dir: "/mock/dir",
      id: "202401011200",
    });
    vi.mocked(fsManager.getNextReviewMetadata).mockReturnValue({
      nextNum: 2,
      lastFile: "r-001-base..sha1.md",
    });
    vi.mocked(fs.readFileSync).mockReturnValue("CONTENT_OF_PREVIOUS_REVIEW");
    vi.mocked(git.getGitDiff).mockReturnValue("NEW_DIFF");
    vi.mocked(api.callAI).mockResolvedValue("AI_RESPONSE_CONTENT");

    await runReview();

    // Verify Prompt Construction
    expect(api.callAI).toHaveBeenCalledWith(
      "sk-test",
      "gpt-4",
      expect.stringContaining("PREVIOUS REVIEW:"),
      { temp: 0.7 }
    );
    expect(api.callAI).toHaveBeenCalledWith(
      "sk-test",
      "gpt-4",
      expect.stringContaining("CONTENT_OF_PREVIOUS_REVIEW"),
      expect.any(Object)
    );

    // Verify File Writing
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      "/mock/dir/r-002-sha1..sha2.md",
      "AI_RESPONSE_CONTENT"
    );
  });

  it("logs an error and exits if OPENROUTER_API_KEY is missing when calling AI", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(config.getProviders).mockResolvedValue({
      providers: [{ name: "GPT-4", model: "gpt-4" }],
    });
    vi.mocked(config.getEnv).mockReturnValue({ OPENROUTER_API_KEY: "" });

    vi.mocked(prompts.input).mockResolvedValue("sha");
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
    vi.mocked(config.getEnv).mockReturnValue({ OPENROUTER_API_KEY: "key" });
    vi.mocked(prompts.select).mockResolvedValue({
      isOnlyPrompt: false,
      provider: { name: "GPT-4", model: "gpt-4" },
    });

    vi.mocked(api.callAI).mockRejectedValue(new Error("API Timeout"));

    await expect(runReview()).rejects.toThrow("API Timeout");
  });
});
