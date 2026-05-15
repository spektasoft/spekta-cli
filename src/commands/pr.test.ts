import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";
import * as config from "../core/config";
import * as git from "../git/git";
import * as gitUi from "../git/git-ui";
import * as ui from "../ui/ui";
import * as orchestrator from "../core/orchestrator";
import * as editorUtils from "../editor-utils";
import { runPr } from "./pr";

vi.mock("../core/config");
vi.mock("../git/git");
vi.mock("../git/git-ui");
vi.mock("../ui/ui");
vi.mock("../core/orchestrator");
vi.mock("../editor-utils");

describe("Command: runPr", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.resetAllMocks();
    process.exitCode = undefined;

    (config.getProviders as Mock).mockResolvedValue({
      providers: [{ name: "test-provider", model: "gpt-4" }],
    });
    (config.getPromptContent as Mock).mockResolvedValue(
      "PR Template system prompt",
    );
    (git.resolveHash as Mock).mockResolvedValue("abc1234");
    (git.getNearestMerge as Mock).mockResolvedValue("def5678");
    (git.getCommitMessages as Mock).mockResolvedValue(
      "feat: add login\nfix: correct typo",
    );
    (gitUi.promptHashRange as Mock).mockResolvedValue({
      start: "def5678",
      end: "abc1234",
    });
    (ui.promptProviderSelection as Mock).mockResolvedValue({
      isOnlyPrompt: false,
      provider: { name: "test-provider", model: "gpt-4" },
    });
    (orchestrator.executeAiAction as Mock).mockResolvedValue(
      "```markdown\nPR description\n```",
    );
    (git.stripCodeFences as Mock).mockReturnValue("PR description");
    (git.formatCommitMessage as Mock).mockResolvedValue("PR description");
    (editorUtils.processOutput as Mock).mockResolvedValue(
      "/tmp/spekta-pr-12345.md",
    );
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it("should save prompt to file without calling AI when isOnlyPrompt is selected", async () => {
    // Arrange
    const systemPrompt = "PR Template system prompt";
    const commitMessages = "feat: add login\nfix: correct typo";
    const expectedContent =
      `${systemPrompt}\n` +
      `### COMMIT MESSAGES\n\`\`\`markdown\n${commitMessages}\n\`\`\``;

    (ui.promptProviderSelection as Mock).mockResolvedValue({
      isOnlyPrompt: true,
    });

    // Act
    await runPr();

    // Assert
    expect(orchestrator.executeAiAction).not.toHaveBeenCalled();
    expect(editorUtils.processOutput).toHaveBeenCalledWith(
      expectedContent,
      "spekta-pr-prompt",
    );
  });

  it("should generate PR message via AI, strip fences, format, and save output", async () => {
    // Arrange
    const mockRawAi = "```markdown\nPR description\n```";
    const mockStripped = "PR description";
    const mockFormatted = "PR description";

    (orchestrator.executeAiAction as Mock).mockResolvedValue(mockRawAi);
    (git.stripCodeFences as Mock).mockReturnValue(mockStripped);
    (git.formatCommitMessage as Mock).mockResolvedValue(mockFormatted);

    // Act
    await runPr();

    // Assert
    expect(config.getPromptContent).toHaveBeenCalledWith("pull-request.md");

    expect(gitUi.promptHashRange).toHaveBeenCalledWith("def5678", "abc1234");

    expect(git.getCommitMessages).toHaveBeenCalledWith("def5678", "abc1234");

    expect(orchestrator.executeAiAction).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({ model: "gpt-4" }),
        messages: [
          {
            role: "system",
            content: "PR Template system prompt",
          },
          {
            role: "user",
            content: expect.stringContaining("feat: add login"),
          },
        ],
        spinnerTitle: "Generating PR message...",
      }),
    );

    expect(git.stripCodeFences).toHaveBeenCalledWith(mockRawAi);
    expect(git.formatCommitMessage).toHaveBeenCalledWith(mockStripped);

    expect(editorUtils.processOutput).toHaveBeenCalledWith(
      mockFormatted,
      "spekta-pr",
    );
  });

  it("should use initial commit as range start when no nearest merge is found", async () => {
    // Arrange
    (git.getNearestMerge as Mock).mockResolvedValue(null);
    (git.getInitialCommit as Mock).mockResolvedValue("aaa0000");
    (gitUi.promptHashRange as Mock).mockResolvedValue({
      start: "aaa0000",
      end: "abc1234",
    });

    // Act
    await runPr();

    // Assert
    expect(git.getInitialCommit).toHaveBeenCalled();
    expect(gitUi.promptHashRange).toHaveBeenCalledWith("aaa0000", "abc1234");
  });

  it("should propagate error if an upstream dependency rejects", async () => {
    // Arrange
    const mockError = new Error("Git resolution failure");
    (git.resolveHash as Mock).mockRejectedValue(mockError);

    // Act & Assert
    await expect(runPr()).rejects.toThrow("Git resolution failure");
  });
});
