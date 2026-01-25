import { expect, it, vi, beforeEach } from "vitest";
import { runRepl } from "./repl";
import { callAIStream } from "../api";
import { getUserMessage } from "../utils/multiline-input";
import { promptReplProviderSelection } from "../ui/repl";
import { parseToolCalls, executeTool } from "../utils/agent-utils";
import ora from "ora";

// 1. Mock API and Config
vi.mock("../api");
vi.mock("../config", () => ({
  getEnv: vi.fn().mockResolvedValue({ OPENROUTER_API_KEY: "test-key" }),
  getProviders: vi.fn().mockResolvedValue({ providers: [] }),
  getPromptContent: vi.fn().mockResolvedValue("system prompt"),
}));

// 2. Mock UI and Utils
vi.mock("../ui/repl");
vi.mock("../utils/multiline-input");
vi.mock("../utils/session-utils");

// 3. Mock Agent Utils (Crucial for preventing FS operations and parsing logic isolation)
vi.mock("../utils/agent-utils", () => ({
  parseToolCalls: vi.fn(),
  executeTool: vi.fn(),
}));

// 4. Mock UI Libraries
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
    select: vi.fn().mockResolvedValue("accept"),
    // Mock checkbox to always select the first option ([0]) so execution proceeds
    checkbox: vi.fn().mockResolvedValue([0]),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

it("runRepl throws when API key is missing", async () => {
  const { getEnv } = await import("../config");
  vi.mocked(getEnv).mockResolvedValueOnce({ OPENROUTER_API_KEY: "" });
  await expect(runRepl()).rejects.toThrow("OPENROUTER_API_KEY is missing");
});

it("shows loading spinner during AI streaming and stops it when stream starts", async () => {
  vi.mocked(getUserMessage)
    .mockResolvedValueOnce("hello")
    .mockResolvedValueOnce("exit");

  vi.mocked(promptReplProviderSelection).mockResolvedValue({
    model: "test-model",
    name: "test-provider",
  });

  const mockStream = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: "hi" } }] };
    },
  };

  vi.mocked(callAIStream).mockResolvedValue(mockStream as any);

  // Mock parseToolCalls to return empty for simple text
  vi.mocked(parseToolCalls).mockReturnValue([]);

  await runRepl();

  const oraMock = vi.mocked(ora);
  // Note: The actual code uses "Assistant thinking..." so we match that
  expect(oraMock).toHaveBeenCalledWith("Assistant thinking...");

  const spinnerInstance = oraMock.mock.results[0].value;
  expect(spinnerInstance.start).toHaveBeenCalled();
  expect(spinnerInstance.stop).toHaveBeenCalled();
});

it("automatically triggers AI response after successful tool execution", async () => {
  vi.mocked(getUserMessage)
    .mockResolvedValueOnce("hello")
    .mockResolvedValueOnce("exit");

  vi.mocked(promptReplProviderSelection).mockResolvedValue({
    name: "Test",
    model: "test-model",
    config: {},
  });

  const xmlContent = '<write path="test.txt">hello</write>';

  // First call returns a tool call
  const mockStream1 = {
    [Symbol.asyncIterator]: async function* () {
      yield {
        choices: [{ delta: { content: xmlContent } }],
      };
    },
  };

  // Second call (auto-triggered) returns a final response
  const mockStream2 = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: "Done!" } }] };
    },
  };

  vi.mocked(callAIStream)
    .mockResolvedValueOnce(mockStream1 as any)
    .mockResolvedValueOnce(mockStream2 as any);

  // First pass: returns tool
  vi.mocked(parseToolCalls).mockReturnValueOnce([
    {
      type: "write",
      path: "test.txt",
      content: "hello",
      raw: xmlContent,
    },
  ]);
  // Second pass: returns empty (normal text)
  vi.mocked(parseToolCalls).mockReturnValueOnce([]);

  vi.mocked(executeTool).mockResolvedValue("Success");

  await runRepl();

  // callAIStream should be called twice even though getUserMessage was only called once for "hello"
  expect(callAIStream).toHaveBeenCalledTimes(2);
});
