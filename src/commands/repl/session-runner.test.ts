import { describe, expect, it, vi, beforeEach } from "vitest";
import { SessionRunner } from "./session-runner";
import { getUserMessage } from "../../utils/multiline-input";
import { saveSession } from "../../utils/session-utils";
import { callAIStreamWithProvider } from "../../api/api";
import { Provider } from "../../core/config/types";
import { coordinateToolCalls } from "./tool-pipeline";

vi.mock("../../utils/multiline-input");
vi.mock("../../utils/session-utils");
vi.mock("../../api/api");
vi.mock("./stream-consumer", () => ({
  consumeAssistantStream: vi.fn().mockResolvedValue({
    content: "Assistant response",
    reasoning: "",
    interrupted: false,
  }),
}));
vi.mock("./tool-pipeline", () => ({
  coordinateToolCalls: vi.fn().mockResolvedValue({
    pendingToolResults: "",
    shouldAutoTriggerAI: false,
  }),
}));

describe("SessionRunner", () => {
  const provider: Provider = {
    name: "test-provider",
    model: "test-model",
    config: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes turn and terminates loop when user submits exit", async () => {
    vi.mocked(getUserMessage).mockResolvedValueOnce("exit");

    const runner = new SessionRunner("session-1", provider, [
      { role: "system", content: "system prompt" },
    ]);

    await runner.start();

    expect(getUserMessage).toHaveBeenCalledTimes(1);
    expect(callAIStreamWithProvider).not.toHaveBeenCalled();
  });

  it("processes a user turn and persists messages to session storage", async () => {
    vi.mocked(getUserMessage)
      .mockResolvedValueOnce("Hello AI")
      .mockResolvedValueOnce("exit");
    vi.mocked(callAIStreamWithProvider).mockResolvedValue({} as never);

    const runner = new SessionRunner("session-1", provider, [
      { role: "system", content: "system prompt" },
    ]);

    await runner.start();

    expect(callAIStreamWithProvider).toHaveBeenCalledTimes(1);
    expect(saveSession).toHaveBeenCalledWith(
      "session-1",
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "Hello AI" }),
        expect.objectContaining({
          role: "assistant",
          content: "Assistant response",
        }),
      ]),
    );
  });

  it("automatically triggers the next AI turn without prompt when tool results exist", async () => {
    vi.mocked(getUserMessage)
      .mockResolvedValueOnce("Call tool")
      .mockResolvedValueOnce("exit");
    vi.mocked(callAIStreamWithProvider).mockResolvedValue({} as never);

    vi.mocked(coordinateToolCalls)
      .mockResolvedValueOnce({
        pendingToolResults: "Tool execution output",
        shouldAutoTriggerAI: true,
      })
      .mockResolvedValueOnce({
        pendingToolResults: "",
        shouldAutoTriggerAI: false,
      });

    const runner = new SessionRunner("session-1", provider, []);
    await runner.start();

    expect(callAIStreamWithProvider).toHaveBeenCalledTimes(2);
    expect(saveSession).toHaveBeenCalledWith(
      "session-1",
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: "Tool execution output",
        }),
      ]),
    );
  });

  it("aborts active stream controller on interrupt invocation", async () => {
    const runner = new SessionRunner("session-1", provider, []);
    const abortSpy = vi.fn();
    (runner as any).currentAbortController = {
      abort: abortSpy,
    };

    await runner.interrupt();

    expect(abortSpy).toHaveBeenCalled();
  });
});
