import { expect, it, vi, beforeEach } from "vitest";
import { runRepl, ReplSession } from "./repl";
import { getUserMessage } from "../utils/multiline-input";
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

beforeEach(() => {
  vi.clearAllMocks();
});

it("runRepl initializes and runs session successfully to exit", async () => {
  vi.mocked(getUserMessage).mockResolvedValueOnce("exit");

  await expect(runRepl()).resolves.not.toThrow();

  expect(saveSession).toHaveBeenCalledWith(
    "test-session-id",
    expect.arrayContaining([
      expect.objectContaining({ role: "system", content: "system prompt" }),
    ]),
  );
});

it("ReplSession delegates lifecycle and runs turns until exit", async () => {
  vi.mocked(getUserMessage).mockResolvedValueOnce("exit");

  const session = new ReplSession();
  await session.start();

  expect(getUserMessage).toHaveBeenCalledWith();
});
