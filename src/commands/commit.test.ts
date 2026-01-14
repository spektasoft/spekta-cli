import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import path from "path";
import { runCommit } from "./commit";
import fs from "fs-extra";
import * as config from "../config";
import * as git from "../git";
import * as ui from "../ui";
import * as orchestrator from "../orchestrator";

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
      "Commit Template: {{diff}}"
    );
    (fs.writeFile as unknown as Mock).mockResolvedValue(undefined);
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
      expect.stringContaining("Warning: Staged diff is large")
    );
  });

  it("should generate commit message via AI and save to file", async () => {
    // Arrange
    const mockDiff = "diff content";
    const mockAiResult = "feat: added login";
    const mockProvider = { name: "test-provider", model: "gpt-4" };

    (git.getStagedDiff as Mock).mockResolvedValue(mockDiff);
    (ui.promptProviderSelection as Mock).mockResolvedValue({
      isOnlyPrompt: false,
      provider: mockProvider,
    });
    (orchestrator.executeAiAction as Mock).mockResolvedValue(mockAiResult);

    // Act
    await runCommit();

    // Assert
    // 1. Check AI execution
    expect(orchestrator.executeAiAction).toHaveBeenCalledWith({
      apiKey: "sk-test",
      provider: mockProvider,
      prompt: "Commit Template: diff content",
      spinnerTitle: expect.stringContaining("Generating commit message"),
    });

    // 2. Check File Save
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(path.join("/tmp/mock-dir", "spekta-commit-")),
      mockAiResult,
      "utf-8"
    );

    // 3. Check Success Log
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Generated:")
    );
  });

  it("should save prompt to file without calling AI when isOnlyPrompt is selected", async () => {
    // Arrange
    const mockDiff = "diff content";
    (git.getStagedDiff as Mock).mockResolvedValue(mockDiff);
    (ui.promptProviderSelection as Mock).mockResolvedValue({
      isOnlyPrompt: true,
    });

    // Act
    await runCommit();

    // Assert
    expect(orchestrator.executeAiAction).not.toHaveBeenCalled();

    const expectedPrompt = "Commit Template: diff content";
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(path.join("/tmp/mock-dir", "spekta-prompt-")),
      expectedPrompt,
      "utf-8"
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
