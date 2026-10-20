import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import {
  callAI,
  callAIStream,
  callAIWithProvider,
  Message,
  resolveApiKey,
} from "./api";
import { Provider } from "../core/config";

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
    const createMock = vi
      .fn<
        (params: {
          messages: Array<Record<string, unknown>>;
        }) => Promise<unknown>
      >()
      .mockResolvedValue({
        choices: [{ message: { content: "Refactored code" } }],
      });
    const mockClient = {
      chat: {
        completions: {
          create: createMock,
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

    await callAI("key", "model", messages, {}, mockClient);
    const payload = createMock.mock.calls[0][0];
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]).toEqual({
      role: "user",
      content: "Hello, world!",
    });
  });

  it("strips the reasoning field from the message history for callAIStream", async () => {
    const createMock = vi
      .fn<
        (params: {
          messages: Array<Record<string, unknown>>;
        }) => Promise<unknown>
      >()
      .mockResolvedValue({
        choices: [{ message: { content: "Refactored code" } }],
      });
    const mockClient = {
      chat: {
        completions: {
          create: createMock,
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

    await callAIStream("key", "model", messages, {}, mockClient);
    const payload = createMock.mock.calls[0][0];
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]).toEqual({
      role: "user",
      content: "Hello, world!",
    });
  });

  it("preserves standard fields like 'name' while removing 'reasoning'", async () => {
    const createMock = vi
      .fn<
        (params: {
          messages: Array<Record<string, unknown>>;
        }) => Promise<unknown>
      >()
      .mockResolvedValue({
        choices: [{ message: { content: "test response" } }],
      });
    const mockClient = {
      chat: {
        completions: {
          create: createMock,
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

    await callAI("key", "gpt-4", messages, {}, mockClient);
    const payload = createMock.mock.calls[0][0];

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

  it("sends the selected OpenRouter model and request options to the configured endpoint", async () => {
    const originalFetch = globalThis.fetch;
    let request:
      | { url: string; headers: Headers; body: Record<string, unknown> }
      | undefined;

    globalThis.fetch = (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      request = {
        url,
        headers: new Headers(init?.headers),
        body: JSON.parse(init?.body as string) as Record<string, unknown>,
      };

      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "completion-1",
            object: "chat.completion",
            created: 1,
            model: "openrouter/test-model",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Provider reply" },
                finish_reason: "stop",
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    };

    try {
      const result = await callAI(
        "openrouter-regression-key",
        "openrouter/test-model",
        [{ role: "user", content: "Hello" }],
        { temperature: 0.25, max_tokens: 37 },
      );

      expect(result).toBe("Provider reply");
      expect(request?.url).toBe(
        "https://openrouter.ai/api/v1/chat/completions",
      );
      expect(request?.headers.get("authorization")).toBe(
        "Bearer openrouter-regression-key",
      );
      expect(request?.body).toMatchObject({
        model: "openrouter/test-model",
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.25,
        max_tokens: 37,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves provider errors returned by the chat-completion client", async () => {
    const providerError = new Error("Provider request failed");
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(providerError),
        },
      },
    } as unknown as OpenAI;

    await expect(
      callAI(
        "key",
        "model",
        [{ role: "user", content: "Hello" }],
        {},
        mockClient,
      ),
    ).rejects.toBe(providerError);
  });

  it("uses the selected OpenRouter provider model and request configuration", async () => {
    const originalApiKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "provider-selection-key";
    const createMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "Selected provider reply" } }],
    });
    const mockClient = {
      chat: { completions: { create: createMock } },
    } as unknown as OpenAI;

    try {
      const result = await callAIWithProvider(
        {
          name: "OpenRouter test",
          model: "vendor/selected-model",
          type: "openrouter",
        },
        [{ role: "user", content: "Use the configured provider." }],
        { temperature: 0.35 },
        mockClient,
      );

      expect(result).toBe("Selected provider reply");
      expect(createMock).toHaveBeenCalledWith({
        model: "vendor/selected-model",
        messages: [{ role: "user", content: "Use the configured provider." }],
        temperature: 0.35,
      });
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = originalApiKey;
      }
    }
  });

  it("keeps streaming request options and forwards cancellation to the SDK", async () => {
    const controller = new AbortController();
    const stream = (async function* () {
      await Promise.resolve();
      yield { choices: [] };
      yield {
        choices: [{ delta: { content: "done" }, finish_reason: "stop" }],
      };
    })();
    const createMock = vi.fn().mockResolvedValue(stream);
    const mockClient = {
      chat: { completions: { create: createMock } },
    } as unknown as OpenAI;

    const returnedStream = await callAIStream(
      "key",
      "selected-model",
      [
        {
          role: "user",
          content: "Hello",
          reasoning: "private reasoning",
        },
      ],
      { temperature: 0.4 },
      mockClient,
      controller.signal,
    );

    expect(returnedStream).toBe(stream);
    expect(createMock).toHaveBeenCalledWith(
      {
        model: "selected-model",
        messages: [{ role: "user", content: "Hello" }],
        stream: true,
        temperature: 0.4,
      },
      { signal: controller.signal },
    );
  });
});
