import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import * as config from "../core/config";
import * as git from "../git/git";
import * as orchestrator from "../core/orchestrator";
import * as ui from "../ui/ui";
import * as fsUtils from "../utils/fs-utils";
import { parseCommitArgs, resolveProvider, runCommit } from "./commit";

// Mock external modules
vi.mock("fs-extra");
vi.mock("os", () => ({
  default: {
    tmpdir: () => "/tmp/mock-dir",
    homedir: () => "/tmp/mock-home-dir",
  },
}));
vi.mock("../core/config");
vi.mock("../git/git");
vi.mock("../ui/ui");
vi.mock("../core/orchestrator");
vi.mock("../utils/fs-utils");

describe("Command: runCommit", () => {
  // Spies for console and process
  const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});
  const stdoutWriteSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  // Save original exitCode
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.resetAllMocks();
    process.exitCode = undefined; // Reset exit code

    // Default Mock Implementations
    (config.getProviders as Mock).mockResolvedValue({
      providers: [{ name: "test-provider", model: "gpt-4" }],
    });
    (config.getIgnorePatterns as Mock).mockResolvedValue([]);
    (config.getPromptContent as Mock).mockResolvedValue(
      "Commit Template: {{diff}}",
    );
    (config.getEnv as Mock).mockResolvedValue({});
    (fs.writeFile as unknown as Mock).mockResolvedValue(undefined);
    (vi.mocked(fsUtils.getTempPath) as Mock).mockImplementation((prefix) => {
      return `/mock-tmp/${prefix}-12345.md`;
    });
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it.each<[string[], string]>([
    [["--prompt-only", "--message"], "Only one of"],
    [["--prompt-only", "--model", "gpt-4"], "cannot be combined"],
    [["--message"], "--model is required"],
    [["--commit"], "--model is required"],
    [["--interactive", "--message"], "cannot be combined"],
    [["--commit", "--model", "gpt-4", "--stdout"], "cannot be combined"],
  ])("rejects invalid option combination %j", (args, message) => {
    expect(() => parseCommitArgs(args)).toThrow(message);
  });

  it("rejects invalid combinations before loading repository state", async () => {
    await runCommit(["--message"]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error: --model is required with --message and --commit",
    );
    expect(process.exitCode).toBe(1);
    expect(config.getIgnorePatterns).not.toHaveBeenCalled();
    expect(git.getStagedDiff).not.toHaveBeenCalled();
  });

  it("resolves providers by exact name or model", () => {
    const providers = [
      { name: "OpenAI", model: "gpt-4" },
      { name: "Gemini", model: "gemini-pro" },
    ];

    expect(resolveProvider("OpenAI", providers)).toBe(providers[0]);
    expect(resolveProvider("gemini-pro", providers)).toBe(providers[1]);
    expect(() => resolveProvider("missing", providers)).toThrow("Unknown");
    expect(() =>
      resolveProvider("duplicate", [
        { name: "duplicate", model: "one" },
        { name: "other", model: "duplicate" },
      ]),
    ).toThrow("Ambiguous");
  });

  it("should log error and return if no staged changes found", async () => {
    // Arrange
    (git.getStagedDiff as Mock).mockResolvedValue("");

    // Act
    await runCommit(["--interactive"]);

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
    await runCommit(["--interactive"]);

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
    await runCommit(["--interactive"]);

    // Assert
    expect(orchestrator.executeAiAction).toHaveBeenCalledWith(
      expect.objectContaining({
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
    await runCommit(["--interactive"]);

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

  it("should save the full prompt by default without entering the interactive flow", async () => {
    const mockDiff = "diff --git a/file.txt b/file.txt\n+new content";
    const systemPrompt = "Commit Template: {{diff}}";
    (git.getStagedDiff as Mock).mockResolvedValue(mockDiff);
    (config.getPromptContent as Mock).mockResolvedValue(systemPrompt);

    await runCommit();

    const expectedContent = `${systemPrompt}\n### GIT STAGED DIFF\n\`\`\`markdown\n${mockDiff}\n\`\`\``;
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/mock-tmp/spekta-prompt-12345.md",
      expectedContent,
      "utf-8",
    );
    expect(ui.promptProviderSelection).not.toHaveBeenCalled();
    expect(orchestrator.executeAiAction).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Output saved to: /mock-tmp/spekta-prompt-12345.md",
      ),
    );
  });

  it("should write the full prompt to stdout without persisting it", async () => {
    const mockDiff = "diff --git a/file.txt b/file.txt\n+new content";
    const systemPrompt = "Commit Template: {{diff}}";
    (git.getStagedDiff as Mock).mockResolvedValue(mockDiff);
    (config.getPromptContent as Mock).mockResolvedValue(systemPrompt);

    await runCommit(["--stdout"]);

    const expectedContent = `${systemPrompt}\n### GIT STAGED DIFF\n\`\`\`markdown\n${mockDiff}\n\`\`\``;
    expect(stdoutWriteSpy).toHaveBeenCalledWith(expectedContent);
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(ui.promptProviderSelection).not.toHaveBeenCalled();
  });

  it("should generate a message to stdout without editor, temp file, or confirmation", async () => {
    (git.getStagedDiff as Mock).mockResolvedValue("diff");
    (orchestrator.executeAiAction as Mock).mockResolvedValue(
      "```text\nfeat: test\n```",
    );
    (git.formatCommitMessage as Mock).mockResolvedValue("feat: test");

    await runCommit(["--model", "gpt-4", "--message", "--stdout"]);

    expect(stdoutWriteSpy).toHaveBeenCalledWith("feat: test");
    expect(orchestrator.executeAiAction).toHaveBeenCalledWith(
      expect.objectContaining({ quiet: true }),
    );
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(ui.confirmCommit).not.toHaveBeenCalled();
  });

  it("should commit directly and clean up the temporary message file", async () => {
    (fs.pathExists as unknown as Mock).mockResolvedValue(true);
    (git.getStagedDiff as Mock).mockResolvedValue("diff");
    (orchestrator.executeAiAction as Mock).mockResolvedValue("feat: test");
    (git.formatCommitMessage as Mock).mockResolvedValue("feat: test");
    (git.commitWithFile as Mock).mockResolvedValue(undefined);

    await runCommit(["--model", "gpt-4", "--commit"]);

    expect(git.commitWithFile).toHaveBeenCalledWith(
      "/mock-tmp/spekta-commit-12345.md",
    );
    expect(ui.confirmCommit).not.toHaveBeenCalled();
    expect(fs.remove as unknown as Mock).toHaveBeenCalledWith(
      "/mock-tmp/spekta-commit-12345.md",
    );
  });

  it("cleans up the direct-commit file when committing fails", async () => {
    (fs.pathExists as unknown as Mock).mockResolvedValue(true);
    (git.getStagedDiff as Mock).mockResolvedValue("diff");
    (orchestrator.executeAiAction as Mock).mockResolvedValue("feat: test");
    (git.formatCommitMessage as Mock).mockResolvedValue("feat: test");
    (git.commitWithFile as Mock).mockRejectedValue(new Error("commit failed"));

    await runCommit(["--model", "gpt-4", "--commit"]);

    expect(process.exitCode).toBe(1);
    expect(fs.remove as unknown as Mock).toHaveBeenCalledWith(
      "/mock-tmp/spekta-commit-12345.md",
    );
  });

  it("should reject unknown options before doing commit work", async () => {
    await runCommit(["--unknown"]);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error: Unknown option: --unknown",
    );
    expect(process.exitCode).toBe(1);
    expect(git.getStagedDiff).not.toHaveBeenCalled();
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
