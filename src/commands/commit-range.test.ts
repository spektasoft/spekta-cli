import { beforeEach, describe, expect, it, vi } from "vitest";
import * as config from "../config";
import * as git from "../git";
import * as ui from "../ui";
import { runCommitRange } from "./commit-range";

describe("runCommitRange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should handle valid commit range with CLI arguments", async () => {
    // Mock process.argv
    process.argv = ["node", "spekta", "commit-range", "abc1234", "def5678"];

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

    await runCommitRange();

    expect(git.resolveHash).toHaveBeenCalledTimes(2);
    expect(git.getCommitMessages).toHaveBeenCalled();
  });

  it("should error on empty commit range", async () => {
    process.argv = ["node", "spekta", "commit-range", "abc1234", "abc1234"];

    vi.spyOn(git, "resolveHash").mockResolvedValue(
      "abc1234567890abcdef1234567890abcdef1234",
    );
    vi.spyOn(git, "getCommitMessages").mockResolvedValue("");

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await runCommitRange();

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

    process.argv = ["node", "spekta", "commit-range", "HEAD~1", "main"];

    await runCommitRange();

    // Verify resolution was called with symbolic names
    expect(resolveSpy).toHaveBeenCalledWith("HEAD~1");
    expect(resolveSpy).toHaveBeenCalledWith("main");

    // Verify message retrieval used the resolved hashes, not the symbols
    expect(messagesSpy).toHaveBeenCalledWith("sha1_abc", "sha1_def");
  });
});
