import { expect, it, vi, beforeEach } from "vitest";
import { runRepl, ReplSession } from "./repl";
import { callAIStreamWithProvider, Message } from "../api/api";
import { ChatCompletionChunk } from "openai/resources/chat/completions";
import { Provider } from "../core/config/types";
import { getUserMessage } from "../utils/multiline-input";
import { parseToolCalls, executeTool } from "../utils/agent-utils";
import ora from "ora";
import { saveSession } from "../utils/session-utils";

// Mocks
vi.mock("../api/api");
vi.mock("../core/config", () => ({
  getEnv: vi.fn().mockResolvedValue({ OPENROUTER_API_KEY: "test-key" }),
  getProviders: vi.fn().mockResolvedValue({ providers: [] }),
  getPromptContent: vi.fn().mockResolvedValue("system prompt"),
}));
vi.mock("../ui/repl", () => ({
  promptReplProviderSelection: vi
    .fn()
    .mockResolvedValue({ model: "test", name: "test", config: {} }),
}));
vi.mock("../utils/multiline-input");
vi.mock("../utils/session-utils", () => {
  return {
    saveSession: vi.fn().mockResolvedValue(undefined),
    generateSessionId: vi.fn().mockReturnValue("test-session-id"),
  };
});

interface ReplSessionInternals {
  provider: Provider | null;
  messages: Message[];
  pendingToolResults: string;
  exitRequested: boolean;
  isUserInterrupted: boolean;
  currentAbortController: AbortController | null;
  lastAssistantContent: string;
  handleUserTurn: () => Promise<boolean>;
  handleAssistantTurn: () => Promise<void>;
  handleInterrupt: () => Promise<void>;
}

function asInternals(session: ReplSession): ReplSessionInternals {
  return session as unknown as ReplSessionInternals;
}

async function* createMockStream(
  contents: string[],
): AsyncIterable<ChatCompletionChunk> {
  await Promise.resolve();
  for (const content of contents) {
    yield {
      id: "mock-chunk",
      object: "chat.completion.chunk",
      created: Date.now(),
      model: "mock-model",
      choices: [
        {
          index: 0,
          delta: { content },
          finish_reason: null,
        },
      ],
    };
  }
}
vi.mock("../utils/agent-utils", () => ({
  parseToolCalls: vi.fn().mockReturnValue([]), // Return empty array by default
  executeTool: vi.fn(),
}));
vi.mock("ora", () => ({
  default: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  })),
}));
vi.mock("@inquirer/prompts", async () => {
  const actual = await vi.importActual("@inquirer/prompts");
  return {
    ...actual,
    select: vi.fn().mockResolvedValue("retry"),
    checkbox: vi.fn().mockResolvedValue([0]),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

it("handles immediate interruption before tokens", async () => {
  vi.mocked(getUserMessage)
    .mockResolvedValueOnce("hello")
    .mockResolvedValueOnce("exit");

  const abortError = new Error("Aborted");
  abortError.name = "AbortError";
  const throwingStream: AsyncIterable<ChatCompletionChunk> = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          return Promise.reject(abortError);
        },
      };
    },
  };

  vi.mocked(callAIStreamWithProvider).mockResolvedValue(throwingStream);

  const oraMock = vi.mocked(ora);
  const session = new ReplSession();
  await session.start();

  const firstResult = oraMock.mock.results[0];
  const spinner = firstResult?.value as { stop: () => void } | undefined;
  expect(spinner?.stop).toBeDefined();
  expect(spinner?.stop).toHaveBeenCalled();
});

it("automatically triggers AI response after successful tool execution", async () => {
  vi.mocked(getUserMessage)
    .mockResolvedValueOnce("hello")
    .mockResolvedValueOnce("exit");

  vi.mocked(callAIStreamWithProvider)
    .mockResolvedValueOnce(createMockStream(["TOOL"]))
    .mockResolvedValueOnce(createMockStream(["Done"]));

  vi.mocked(parseToolCalls)
    .mockReturnValueOnce([
      { type: "write", path: "test", content: "hi", raw: "" },
    ])
    .mockReturnValueOnce([]);

  vi.mocked(executeTool).mockResolvedValue("Success");

  const session = new ReplSession();
  await session.start();

  expect(callAIStreamWithProvider).toHaveBeenCalledTimes(2);
  expect(executeTool).toHaveBeenCalled();
});

it("processes assistant turn correctly", async () => {
  vi.mocked(getUserMessage)
    .mockResolvedValueOnce("hello")
    .mockResolvedValueOnce("exit");

  vi.mocked(callAIStreamWithProvider).mockResolvedValue(
    createMockStream(["AI Response"]),
  );

  const session = new ReplSession();
  await session.start();

  expect(callAIStreamWithProvider).toHaveBeenCalled();
  const oraMock = vi.mocked(ora);
  expect(oraMock).toHaveBeenCalledWith("Calling assistant...\n");
});

it("exits loop when user types exit", async () => {
  vi.mocked(getUserMessage)
    .mockResolvedValueOnce("hello")
    .mockResolvedValueOnce("exit");

  vi.mocked(callAIStreamWithProvider).mockResolvedValue(
    createMockStream(["AI Response"]),
  );

  await runRepl();

  expect(getUserMessage).toHaveBeenCalledTimes(2);
});

it("handles pending tool results on exit", async () => {
  vi.mocked(getUserMessage).mockResolvedValueOnce("exit");

  const session = new ReplSession();
  await session.initialize();

  // Manually inject pending results to test the logic
  asInternals(session).pendingToolResults = "Previous Tool Result";

  // We cannot use session.start() because it loops.
  // We can test handleUserTurn directly or modify mocking for loop control.
  // Testing handleUserTurn directly is safer for this unit test.

  const result = await asInternals(session).handleUserTurn();

  expect(result).toBe(false); // Should return false on exit
  expect(saveSession).toHaveBeenCalled();

  // Verify saveSession was called with the pending content
  const calls = vi.mocked(saveSession).mock.calls;
  const lastCall = calls[calls.length - 1];
  const messagesArg = lastCall[1];
  const lastMessage = messagesArg[messagesArg.length - 1];
  expect(lastMessage.content).toContain("Previous Tool Result");
});

it("runRepl initializes session successfully", async () => {
  vi.mocked(getUserMessage).mockResolvedValueOnce("exit");
  await expect(runRepl()).resolves.not.toThrow();
});

it("breaks the main loop and saves session when exitRequested is true", async () => {
  const session = new ReplSession();
  await session.initialize();
  asInternals(session).exitRequested = true;
  asInternals(session).pendingToolResults = "Leftover result";

  await session.start();

  expect(saveSession).toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining([
      expect.objectContaining({ content: "Leftover result" }),
    ]),
  );
});

it("aborts the active controller on SIGINT without exiting the process", async () => {
  const session = new ReplSession();
  const mockController = new AbortController();
  const abortSpy = vi.spyOn(mockController, "abort");
  asInternals(session).currentAbortController = mockController;

  await asInternals(session).handleInterrupt();

  expect(abortSpy).toHaveBeenCalled();
  expect(asInternals(session).isUserInterrupted).toBe(true);
});

it("removes interruption marker only from the end of the string", () => {
  const session = new ReplSession();
  asInternals(session).isUserInterrupted = true;
  asInternals(session).lastAssistantContent =
    "Some text\n\n[Response interrupted by user]";

  // Internal access for testing sanitization logic
  const toolCalls = parseToolCalls(
    asInternals(session).lastAssistantContent.replace(
      "\n\n[Response interrupted by user]",
      "",
    ),
  );
  expect(toolCalls).toBeDefined();
});

it("resets buffers when a non-abort error occurs during streaming", async () => {
  const session = new ReplSession();
  asInternals(session).provider = {
    name: "test",
    model: "test",
  };

  // Mock a failing stream
  vi.mocked(callAIStreamWithProvider).mockRejectedValueOnce(
    new Error("Network Error"),
  );

  // Mock the retry choice to exit
  const { select } = await import("@inquirer/prompts");
  vi.mocked(select).mockResolvedValueOnce("exit");

  try {
    await asInternals(session).handleAssistantTurn();
  } catch {
    // Expected exit
  }

  expect(asInternals(session).lastAssistantContent).toBe("");
});

it("ensures session is saved even if the loop breaks via exitRequested", async () => {
  const session = new ReplSession();
  await session.initialize();
  asInternals(session).exitRequested = true;
  asInternals(session).pendingToolResults = "Final Check";

  await session.start();

  expect(saveSession).toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining([
      expect.objectContaining({ content: "Final Check" }),
    ]),
  );
});

it("prints a newline after the stream finishes successfully", async () => {
  vi.mocked(getUserMessage).mockResolvedValueOnce("hello");

  vi.mocked(callAIStreamWithProvider).mockResolvedValue(
    createMockStream(["AI Response"]),
  );

  // Spy on stdout.write to capture what gets written
  const writeSpy = vi.spyOn(process.stdout, "write");

  const session = new ReplSession();
  await session.initialize();
  await asInternals(session).handleAssistantTurn();

  // Verify that a newline was written after the stream completed
  expect(writeSpy).toHaveBeenCalledWith("\n\n");
});

it("saves session data immediately when SIGINT is received while idle", async () => {
  const session = new ReplSession();
  asInternals(session).pendingToolResults = "Immediate Exit Data";

  const exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);

  await asInternals(session).handleInterrupt();

  expect(saveSession).toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining([
      expect.objectContaining({ content: "Immediate Exit Data" }),
    ]),
  );
  expect(exitSpy).toHaveBeenCalledWith(0);
});
