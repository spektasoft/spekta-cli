import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as config from "../config";
import * as editorUtils from "../editor-utils";
import * as git from "../git";
import * as ui from "../ui";
import { runSummarize } from "./summarize";

// Mock UI dependencies to handle direct imports
vi.mock("../ui", () => ({
  getTokenCount: vi.fn(),
  confirmLargePayload: vi.fn(),
  promptProviderSelection: vi.fn(),
  promptCommitHash: vi.fn(),
}));

// Mock Config dependencies to prevent file I/O issues
vi.mock("../config", () => ({
  getPromptContent: vi.fn(),
  getProviders: vi.fn(),
  getEnv: vi.fn(),
}));

// Mock Editor Utils to prevent file writing
vi.mock("../editor-utils", () => ({
  processOutput: vi.fn(),
}));

// Mock Orchestrator to prevent actual LLM calls
vi.mock("../orchestrator", () => ({
  executeAiAction: vi.fn(),
}));

describe("runSummarize", () => {
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should handle valid commit range with CLI arguments", async () => {
    // Mock process.argv
    process.argv = ["node", "spekta", "summarize", "abc1234", "def5678"];

    // Mock git functions
    vi.spyOn(git, "resolveHash")
      .mockResolvedValueOnce("abc1234567890abcdef1234567890abcdef1234")
      .mockResolvedValueOnce("def5678901234def5678901234def5678901234");

    vi.spyOn(git, "getCommitMessages").mockResolvedValue(
      "feat: test\n---\nfix: another",
    );

    // Mock config
    vi.spyOn(config, "getPromptContent").mockResolvedValue("System prompt");
    vi.spyOn(config, "getProviders").mockResolvedValue({ providers: [] });
    vi.spyOn(config, "getEnv").mockResolvedValue({
      OPENROUTER_API_KEY: "test",
    });

    // Mock UI - select "Only Prompt"
    vi.spyOn(ui, "promptProviderSelection").mockResolvedValue({
      isOnlyPrompt: true,
      provider: undefined,
    });

    await runSummarize();

    expect(git.resolveHash).toHaveBeenCalledTimes(2);
    expect(git.getCommitMessages).toHaveBeenCalled();
  });

  it("should error on empty commit range", async () => {
    process.argv = ["node", "spekta", "summarize", "abc1234", "abc1234"];

    vi.spyOn(git, "resolveHash").mockResolvedValue(
      "abc1234567890abcdef1234567890abcdef1234",
    );
    vi.spyOn(git, "getCommitMessages").mockResolvedValue("");

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await runSummarize();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Ensure the first commit is an ancestor of the second",
      ),
    );
    expect(process.exitCode).toBe(1);
  });

  it("should properly format range even when symbolic refs are used", async () => {
    const resolveSpy = vi
      .spyOn(git, "resolveHash")
      .mockResolvedValueOnce("sha1_abc")
      .mockResolvedValueOnce("sha1_def");

    const messagesSpy = vi
      .spyOn(git, "getCommitMessages")
      .mockResolvedValue("feat: mock");

    process.argv = ["node", "spekta", "summarize", "HEAD~1", "main"];

    await runSummarize();

    // Verify resolution was called with symbolic names
    expect(resolveSpy).toHaveBeenCalledWith("HEAD~1");
    expect(resolveSpy).toHaveBeenCalledWith("main");

    // Verify message retrieval used the resolved hashes, not the symbols
    expect(messagesSpy).toHaveBeenCalledWith("sha1_abc", "sha1_def");
  });

  it("should fail gracefully if the range is invalid or empty", async () => {
    // Setup git mocks for empty result
    vi.spyOn(git, "resolveHash").mockResolvedValue("sha_mock");
    vi.spyOn(git, "getCommitMessages").mockResolvedValue(""); // Empty messages

    process.argv = ["node", "spekta", "summarize", "HEAD~1", "HEAD"];

    await runSummarize();
    expect(process.exitCode).toBe(1);
  });

  it("should resolve symbolic references before fetching messages", async () => {
    // Setup mocks
    const resolveSpy = vi
      .spyOn(git, "resolveHash")
      .mockResolvedValueOnce("sha_abc")
      .mockResolvedValueOnce("sha_def");

    vi.spyOn(git, "getCommitMessages").mockResolvedValue("feat: valid commit");
    // Mock config to ensure we don't crash on getPromptContent
    vi.mocked(config.getPromptContent).mockResolvedValue("System Prompt");
    // Mock token count to be safe (low value)
    vi.mocked(ui.getTokenCount).mockReturnValue(100);

    process.argv = ["node", "spekta", "summarize", "HEAD~1", "main"];

    await runSummarize();

    expect(resolveSpy).toHaveBeenCalledWith("HEAD~1");
    expect(resolveSpy).toHaveBeenCalledWith("main");
  });

  it("should halt execution if the token count exceeds threshold and user cancels", async () => {
    // 1. Setup Git Mocks
    vi.spyOn(git, "resolveHash").mockResolvedValue("mock-sha");
    vi.spyOn(git, "getCommitMessages").mockResolvedValue("feat: heavy commit");
    vi.spyOn(git, "sanitizeMessageForPrompt").mockReturnValue("sanitized");

    // 2. Setup Config Mocks (CRITICAL FIX)
    // If this is missing, the code crashes before checking tokens
    vi.mocked(config.getPromptContent).mockResolvedValue("System Prompt");

    // 3. Setup UI Mocks
    // Force token count above 5000
    vi.mocked(ui.getTokenCount).mockReturnValue(6000);
    // User selects 'No' / Cancel
    vi.mocked(ui.confirmLargePayload).mockResolvedValue(false);

    // Mock editor utils for the cancellation flow
    vi.mocked(editorUtils.processOutput).mockResolvedValue("saved-file.txt");

    // 4. Execution
    process.argv = ["node", "spekta", "summarize", "HEAD~5", "HEAD"];
    await runSummarize();

    // 5. Verification
    expect(ui.confirmLargePayload).toHaveBeenCalledWith(6000);
    // Ensure we did NOT proceed to provider selection
    expect(ui.promptProviderSelection).not.toHaveBeenCalled();
  });
});
