import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import {
  callAI,
  callAIStream,
  Message,
  resolveApiKey,
  callAIWithProvider,
} from "./api";
import { Provider } from "./config";

describe("resolveApiKey", () => {
  it("returns OPENROUTER_API_KEY for openrouter providers", () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    const p: Provider = { name: "Test", model: "m", type: "openrouter" };
    expect(resolveApiKey(p)).toBe("or-key");
  });

  it("returns OPENROUTER_API_KEY when type is absent", () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    const p: Provider = { name: "Test", model: "m" };
    expect(resolveApiKey(p)).toBe("or-key");
  });

  it("returns GEMINI_API_KEY for gemini providers", () => {
    process.env.GEMINI_API_KEY = "gem-key";
    const p: Provider = {
      name: "Gemini",
      model: "gemini-2.0-flash",
      type: "gemini",
    };
    expect(resolveApiKey(p)).toBe("gem-key");
  });

  it("throws if GEMINI_API_KEY is missing", () => {
    delete process.env.GEMINI_API_KEY;
    const p: Provider = {
      name: "Gemini",
      model: "gemini-2.0-flash",
      type: "gemini",
    };
    expect(() => resolveApiKey(p)).toThrow("GEMINI_API_KEY");
  });
});

describe("callAI", () => {
  it("returns content on successful API call", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "Refactored code" } }],
          }),
        },
      },
    } as unknown as OpenAI;

    const messages = [
      {
        role: "user",
        content: "Hello, world!",
      },
    ] as Message[];

    const result = await callAI("key", "model", messages, {}, mockClient);
    expect(result).toBe("Refactored code");
  });

  it("throws specific error when AI returns null content", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: null } }],
          }),
        },
      },
    } as unknown as OpenAI;

    const messages = [
      {
        role: "user",
        content: "Hello, world!",
      },
    ] as Message[];

    await expect(
      callAI("key", "model", messages, {}, mockClient),
    ).rejects.toThrow("The AI provider returned an empty response.");
  });

  it("strips the reasoning field from the message history for callAI", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "Refactored code" } }],
          }),
        },
      },
    } as unknown as OpenAI;

    const messages = [
      {
        role: "user",
        content: "Hello, world!",
        reasoning: "This is a test message",
      },
    ] as Message[];

    const result = await callAI("key", "model", messages, {}, mockClient);
    // @ts-ignore
    const payload = mockClient.chat.completions.create.mock.calls[0][0];
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]).toEqual({
      role: "user",
      content: "Hello, world!",
    });
  });

  it("strips the reasoning field from the message history for callAIStream", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "Refactored code" } }],
          }),
        },
      },
    } as unknown as OpenAI;

    const messages = [
      {
        role: "user",
        content: "Hello, world!",
        reasoning: "This is a test message",
      },
    ] as Message[];

    const result = await callAIStream("key", "model", messages, {}, mockClient);
    // @ts-ignore
    const payload = mockClient.chat.completions.create.mock.calls[0][0];
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]).toEqual({
      role: "user",
      content: "Hello, world!",
    });
  });

  it("preserves standard fields like 'name' while removing 'reasoning'", async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: "test response" } }],
          }),
        },
      },
    } as unknown as OpenAI;

    const messages = [
      {
        role: "user",
        content: "Hello",
        name: "test_user",
        reasoning: "internal thought process",
      },
      {
        role: "assistant",
        content: "Hi there",
        name: "assistant",
      },
    ] as unknown as Message[];

    const result = await callAI("key", "gpt-4", messages, {}, mockClient);
    // @ts-ignore
    const payload = mockClient.chat.completions.create.mock.calls[0][0];

    expect(payload.messages).toHaveLength(2);
    expect(payload.messages[0]).toEqual({
      role: "user",
      content: "Hello",
      name: "test_user",
      // reasoning should be removed
    });
    expect(payload.messages[1]).toEqual({
      role: "assistant",
      content: "Hi there",
      name: "assistant",
    });
  });
});
