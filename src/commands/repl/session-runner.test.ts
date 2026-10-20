import { afterAll, describe, expect, it, vi, beforeEach } from "vitest";

const originalColorEnvironment = vi.hoisted(() => {
  const original = Object.fromEntries(
    ["FORCE_COLOR", "NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE"].map((name) => [
      name,
      process.env[name],
    ]),
  ) as Record<string, string | undefined>;
  const enabled = process.env.SPEKTA_REPL_COLOR_POLICY === "enabled";

  process.env.FORCE_COLOR = enabled ? "1" : "0";
  delete process.env.NO_COLOR;
  delete process.env.CLICOLOR;
  delete process.env.CLICOLOR_FORCE;

  return original;
});

afterAll(() => {
  for (const [name, value] of Object.entries(originalColorEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});
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

  it("renders multiline user messages at the active terminal width", async () => {
    expect(process.env.FORCE_COLOR).toBe("0");
    expect(process.env.NO_COLOR).toBeUndefined();
    const originalColumns = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(callAIStreamWithProvider).mockResolvedValue({} as never);

    try {
      for (const width of [40, 80, 120]) {
        Object.defineProperty(process.stdout, "columns", {
          configurable: true,
          value: width,
        });
        logSpy.mockClear();
        vi.mocked(getUserMessage)
          .mockReset()
          .mockResolvedValueOnce("first line\nsecond line")
          .mockResolvedValueOnce("exit");

        const runner = new SessionRunner(`session-${width}`, provider, []);
        await runner.start();

        const renderedUserMessage = String(logSpy.mock.calls[0][0]);
        const lines = renderedUserMessage.trimEnd().split("\n");
        expect(lines[0]).toMatch(/^┌/);
        expect(lines.at(-1)).toMatch(/└/);
        expect(new Set(lines.map((line) => line.length)).size).toBe(1);
        expect(lines.every((line) => line.length <= width)).toBe(true);
        expect(renderedUserMessage).toContain("first line");
        expect(renderedUserMessage).toContain("second line");
        expect(
          renderedUserMessage.includes(`${String.fromCharCode(27)}[`),
        ).toBe(false);
      }
    } finally {
      if (originalColumns) {
        Object.defineProperty(process.stdout, "columns", originalColumns);
      } else {
        delete (process.stdout as NodeJS.WriteStream & { columns?: number })
          .columns;
      }
      logSpy.mockRestore();
    }
  });

  it.runIf(process.env.SPEKTA_REPL_COLOR_POLICY === "enabled")(
    "renders user messages with Chalk and Boxen styling when color is enabled",
    async () => {
      expect(process.env.SPEKTA_REPL_COLOR_POLICY).toBe("enabled");
      expect(process.env.FORCE_COLOR).toBe("1");
      expect(process.env.NO_COLOR).toBeUndefined();
      const originalColumns = Object.getOwnPropertyDescriptor(
        process.stdout,
        "columns",
      );
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);
      vi.mocked(getUserMessage)
        .mockResolvedValueOnce("colored user message")
        .mockResolvedValueOnce("exit");
      vi.mocked(callAIStreamWithProvider).mockResolvedValue({} as never);

      try {
        Object.defineProperty(process.stdout, "columns", {
          configurable: true,
          value: 80,
        });

        const runner = new SessionRunner("session-color-enabled", provider, []);
        await runner.start();

        const renderedUserMessage = String(logSpy.mock.calls[0][0]);
        const interactiveHeading = stdoutSpy.mock.calls
          .map(([chunk]) => String(chunk))
          .join("");
        expect(renderedUserMessage).toContain("colored user message");
        expect(
          renderedUserMessage.includes(`${String.fromCharCode(27)}[`),
        ).toBe(true);
        expect(interactiveHeading).toContain("You:");
        expect(interactiveHeading.includes(`${String.fromCharCode(27)}[`)).toBe(
          true,
        );
      } finally {
        if (originalColumns) {
          Object.defineProperty(process.stdout, "columns", originalColumns);
        } else {
          delete (process.stdout as NodeJS.WriteStream & { columns?: number })
            .columns;
        }
        stdoutSpy.mockRestore();
        logSpy.mockRestore();
      }
    },
  );

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
    (
      runner as unknown as { currentAbortController: { abort: () => void } }
    ).currentAbortController = {
      abort: abortSpy,
    };

    await runner.interrupt();

    expect(abortSpy).toHaveBeenCalled();
  });
});
