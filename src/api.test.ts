import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { callAI, callAIStream, Message } from "./api";

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
