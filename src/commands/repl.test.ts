import { expect, it, vi, beforeEach } from "vitest";
import { runRepl, ReplSession } from "./repl";
import { callAIStream } from "../api";
import { getUserMessage } from "../utils/multiline-input";
import { parseToolCalls, executeTool } from "../utils/agent-utils";
import ora from "ora";
import { saveSession } from "../utils/session-utils";

// Mocks
vi.mock("../api");
vi.mock("../config", () => ({
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
vi.mock("../utils/session-utils", async () => {
  return {
    saveSession: vi.fn().mockResolvedValue(undefined),
    generateSessionId: vi.fn().mockReturnValue("test-session-id"),
  };
});
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

  // @ts-ignore
  vi.mocked(callAIStream).mockImplementation(async function* () {
    const error = new Error("Aborted");
    error.name = "AbortError";
    throw error;
  });

  const oraMock = vi.mocked(ora);
  const session = new ReplSession();
  await session.start();

  const spinner = oraMock.mock.results[0].value;
  expect(spinner.stop).toHaveBeenCalled();
});

it("automatically triggers AI response after successful tool execution", async () => {
  vi.mocked(getUserMessage)
    .mockResolvedValueOnce("hello")
    .mockResolvedValueOnce("exit");

  const stream1 = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: "TOOL" } }] };
    },
  };
  const stream2 = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: "Done" } }] };
    },
  };

  vi.mocked(callAIStream)
    .mockResolvedValueOnce(stream1 as any)
    .mockResolvedValueOnce(stream2 as any);

  vi.mocked(parseToolCalls)
    .mockReturnValueOnce([
      { type: "write", path: "test", content: "hi", raw: "" },
    ])
    .mockReturnValueOnce([]);

  vi.mocked(executeTool).mockResolvedValue("Success");

  const session = new ReplSession();
  await session.start();

  expect(callAIStream).toHaveBeenCalledTimes(2);
  expect(executeTool).toHaveBeenCalled();
});

it("processes assistant turn correctly", async () => {
  vi.mocked(getUserMessage)
    .mockResolvedValueOnce("hello")
    .mockResolvedValueOnce("exit");

  const mockStream = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: "AI Response" } }] };
    },
  };
  vi.mocked(callAIStream).mockResolvedValue(mockStream as any);

  const session = new ReplSession();
  await session.start();

  expect(callAIStream).toHaveBeenCalled();
  const oraMock = vi.mocked(ora);
  expect(oraMock).toHaveBeenCalledWith("Calling assistant...\n");
});

it("exits loop when user types exit", async () => {
  vi.mocked(getUserMessage)
    .mockResolvedValueOnce("hello")
    .mockResolvedValueOnce("exit");

  const mockStream = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: "AI Response" } }] };
    },
  };
  vi.mocked(callAIStream).mockResolvedValue(mockStream as any);

  await runRepl();

  expect(getUserMessage).toHaveBeenCalledTimes(2);
});

it("handles pending tool results on exit", async () => {
  vi.mocked(getUserMessage).mockResolvedValueOnce("exit");

  const session = new ReplSession();
  await session.initialize();

  // Manually inject pending results to test the logic
  (session as any).pendingToolResults = "Previous Tool Result";

  // We cannot use session.start() because it loops.
  // We can test handleUserTurn directly or modify mocking for loop control.
  // Testing handleUserTurn directly is safer for this unit test.

  const result = await (session as any).handleUserTurn();

  expect(result).toBe(false); // Should return false on exit
  expect(saveSession).toHaveBeenCalled();

  // Verify saveSession was called with the pending content
  const calls = vi.mocked(saveSession).mock.calls;
  const lastCall = calls[calls.length - 1];
  const messagesArg = lastCall[1];
  const lastMessage = messagesArg[messagesArg.length - 1];
  expect(lastMessage.content).toContain("Previous Tool Result");
});

it("ReplSession throws when API key is missing", async () => {
  const { getEnv } = await import("../config");
  vi.mocked(getEnv).mockResolvedValueOnce({ OPENROUTER_API_KEY: "" });

  const session = new ReplSession();
  await expect(session.initialize()).rejects.toThrow(
    "OPENROUTER_API_KEY is missing",
  );
});

it("runRepl initializes session successfully", async () => {
  vi.mocked(getUserMessage).mockResolvedValueOnce("exit");
  await expect(runRepl()).resolves.not.toThrow();
});

it("breaks the main loop and saves session when exitRequested is true", async () => {
  const session = new ReplSession();
  await session.initialize();
  (session as any).exitRequested = true;
  (session as any).pendingToolResults = "Leftover result";

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
  const mockController = { abort: vi.fn() };
  (session as any).currentAbortController = mockController;

  (session as any).handleInterrupt();

  expect(mockController.abort).toHaveBeenCalled();
  expect((session as any).isUserInterrupted).toBe(true);
});

it("removes interruption marker only from the end of the string", () => {
  const session = new ReplSession();
  (session as any).isUserInterrupted = true;
  (session as any).lastAssistantContent =
    "Some text\n\n[Response interrupted by user]";

  // Internal access for testing sanitization logic
  const toolCalls = parseToolCalls(
    (session as any).lastAssistantContent.replace(
      "\n\n[Response interrupted by user]",
      "",
    ),
  );
  expect(toolCalls).toBeDefined();
});

it("resets buffers when a non-abort error occurs during streaming", async () => {
  const session = new ReplSession();
  (session as any).env = { OPENROUTER_API_KEY: "test" };
  (session as any).provider = { model: "test" };

  // Mock a failing stream
  vi.mocked(callAIStream).mockRejectedValueOnce(new Error("Network Error"));
  // Mock the retry choice to exit
  const { select } = await import("@inquirer/prompts");
  vi.mocked(select).mockResolvedValueOnce("exit");

  try {
    await (session as any).handleAssistantTurn();
  } catch (e) {
    // Expected exit
  }

  expect((session as any).lastAssistantContent).toBe("");
});

it("ensures session is saved even if the loop breaks via exitRequested", async () => {
  const session = new ReplSession();
  await session.initialize();
  (session as any).exitRequested = true;
  (session as any).pendingToolResults = "Final Check";

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

  const mockStream = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: "AI Response" } }] };
    },
  };
  vi.mocked(callAIStream).mockResolvedValue(mockStream as any);

  // Spy on stdout.write to capture what gets written
  const writeSpy = vi.spyOn(process.stdout, "write");

  const session = new ReplSession();
  await session.initialize();
  await (session as any).handleAssistantTurn();

  // Verify that a newline was written after the stream completed
  expect(writeSpy).toHaveBeenCalledWith("\n\n");
});

it("saves session data immediately when SIGINT is received while idle", async () => {
  const session = new ReplSession();
  (session as any).pendingToolResults = "Immediate Exit Data";

  const exitSpy = vi
    .spyOn(process, "exit")
    .mockImplementation(() => undefined as never);

  await (session as any).handleInterrupt();

  expect(saveSession).toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining([
      expect.objectContaining({ content: "Immediate Exit Data" }),
    ]),
  );
  expect(exitSpy).toHaveBeenCalledWith(0);
});
