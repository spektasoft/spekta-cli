import { expect, it, vi, beforeEach } from "vitest";
import { runRepl } from "./repl";
import { callAIStream } from "../api";
import { getUserMessage } from "../utils/multiline-input";
import { promptReplProviderSelection } from "../ui/repl";
import ora from "ora";

vi.mock("../api");
vi.mock("../config", () => ({
  getEnv: vi.fn().mockResolvedValue({ OPENROUTER_API_KEY: "test-key" }),
  getProviders: vi.fn().mockResolvedValue({ providers: [] }),
  getPromptContent: vi.fn().mockResolvedValue("system prompt"),
}));
vi.mock("../ui/repl");
vi.mock("../utils/multiline-input");
vi.mock("../utils/session-utils");
vi.mock("ora", () => ({
  default: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  })),
}));

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

  await runRepl();

  const oraMock = vi.mocked(ora);
  expect(oraMock).toHaveBeenCalledWith("Thinking...");
  
  const spinnerInstance = oraMock.mock.results[0].value;
  expect(spinnerInstance.start).toHaveBeenCalled();
  expect(spinnerInstance.stop).toHaveBeenCalled();
});
