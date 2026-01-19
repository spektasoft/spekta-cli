import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import * as config from "../config";
import * as git from "../git";
import * as orchestrator from "../orchestrator";
import * as ui from "../ui";
import * as fsUtils from "../utils/fs-utils";
import { runCommit } from "./commit";

// Mock external modules
vi.mock("fs-extra");
vi.mock("os", () => ({
  default: {
    tmpdir: () => "/tmp/mock-dir",
    homedir: () => "/tmp/mock-home-dir",
  },
}));
vi.mock("../config");
vi.mock("../git");
vi.mock("../ui");
vi.mock("../orchestrator");

describe("Command: runCommit", () => {
  vi.mock("../utils/fs-utils");

  // Spies for console and process
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  // Save original exitCode
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.resetAllMocks();
    process.exitCode = undefined; // Reset exit code

    // Default Mock Implementations
    (config.getProviders as Mock).mockResolvedValue({
      providers: [{ name: "test-provider", model: "gpt-4" }],
    });
    (config.getEnv as Mock).mockResolvedValue({
      OPENROUTER_API_KEY: "sk-test",
    });
    (config.getIgnorePatterns as Mock).mockResolvedValue([]);
    (config.getPromptContent as Mock).mockResolvedValue(
      "Commit Template: {{diff}}",
    );
    (fs.writeFile as unknown as Mock).mockResolvedValue(undefined);
    (vi.mocked(fsUtils.getTempPath) as Mock).mockImplementation((prefix) => {
      return `/mock-tmp/${prefix}-12345.md`;
    });
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it("should log error and return if no staged changes found", async () => {
    // Arrange
    (git.getStagedDiff as Mock).mockResolvedValue("");

    // Act
    await runCommit();

    // Assert
    expect(consoleErrorSpy).toHaveBeenCalledWith("No staged changes found.");
    expect(ui.promptProviderSelection).not.toHaveBeenCalled();
  });

  it("should warn if staged diff exceeds threshold", async () => {
    // Arrange
    const largeDiff = "a".repeat(30001);
    (git.getStagedDiff as Mock).mockResolvedValue(largeDiff);
    (ui.promptProviderSelection as Mock).mockResolvedValue({
      isOnlyPrompt: true,
    });

    // Act
    await runCommit();

    // Assert
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Warning: Staged diff is large"),
    );
  });

  it("should generate commit message via AI and save to temp file", async () => {
    // Arrange
    const mockDiff = "diff --git a/file.txt b/file.txt\n+new content";
    const mockRawAi =
      "```text\nfeat: add login endpoint\n\nBREAKING CHANGE: requires auth header\n```";

    (git.getStagedDiff as Mock).mockResolvedValue(mockDiff);
    (ui.promptProviderSelection as Mock).mockResolvedValue({
      isOnlyPrompt: false,
      provider: { name: "test-provider", model: "gpt-4" },
    });
    (orchestrator.executeAiAction as Mock).mockResolvedValue(mockRawAi);

    // Act
    await runCommit();

    // Assert
    expect(orchestrator.executeAiAction).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-test",
        provider: expect.objectContaining({ model: "gpt-4" }),
        messages: [
          { role: "system", content: expect.stringContaining("{{diff}}") }, // real prompt from disk
          { role: "user", content: expect.stringContaining(mockDiff) },
        ],
        spinnerTitle: "Generating commit message...",
      }),
    );

    expect(git.stripCodeFences).toHaveBeenCalledWith(mockRawAi);

    expect(fsUtils.getTempPath).toHaveBeenCalledWith("spekta-commit");

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "Output saved to: /mock-tmp/spekta-commit-12345.md",
      ),
    );
  });

  it("should save full prompt + diff to temp file without calling AI when isOnlyPrompt is selected", async () => {
    // Arrange
    const mockDiff = "diff --git a/file.txt b/file.txt\n+new content";
    const realSystemPrompt =
      "You are a helpful commit message generator.\nUse conventional commits.\n{{diff}}";

    (git.getStagedDiff as Mock).mockResolvedValue(mockDiff);
    (config.getPromptContent as Mock).mockResolvedValue(realSystemPrompt);
    (ui.promptProviderSelection as Mock).mockResolvedValue({
      isOnlyPrompt: true,
    });

    // Act
    await runCommit();

    // Assert
    expect(orchestrator.executeAiAction).not.toHaveBeenCalled();

    const expectedContent = `${realSystemPrompt}\n### GIT STAGED DIFF\n\`\`\`markdown\n${mockDiff}\n\`\`\``;

    expect(fsUtils.getTempPath).toHaveBeenCalledWith("spekta-prompt");
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/mock-tmp/spekta-prompt-12345.md",
      expectedContent,
      "utf-8",
    );

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "Output saved to: /mock-tmp/spekta-prompt-12345.md",
      ),
    );
  });

  it("should set exitCode to 1 on unexpected error", async () => {
    // Arrange
    const mockError = new Error("Network failure");
    (git.getStagedDiff as Mock).mockRejectedValue(mockError);

    // Act
    await runCommit();

    // Assert
    expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Network failure");
    expect(process.exitCode).toBe(1);
  });
});
