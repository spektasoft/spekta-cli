import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the SDK before importing the adapter
vi.mock("@google/generative-ai", () => {
  // Define the generator function, but DON'T execute it here
  const createMockStream = async function* () {
    yield {
      candidates: [{ content: { parts: [{ text: "chunk one" }] } }],
    };
    yield {
      candidates: [{ content: { parts: [{ text: " chunk two" }] } }],
    };
  };

  // Use mockImplementation so the logic runs fresh on every call
  const sendMessageStream = vi.fn().mockImplementation(() => {
    return Promise.resolve({
      stream: createMockStream(), // Execute it HERE so a new one is born per call
    });
  });

  const sendMessage = vi.fn().mockResolvedValue({
    response: {
      candidates: [{ content: { parts: [{ text: "Hello from Gemini" }] } }],
      text: () => "Hello from Gemini",
    },
  });

  const startChat = vi.fn().mockReturnValue({ sendMessage, sendMessageStream });
  const getGenerativeModel = vi.fn().mockReturnValue({ startChat });

  // Use a regular function for the constructor
  const GoogleGenerativeAI = vi.fn().mockImplementation(function () {
    return { getGenerativeModel };
  });

  return { GoogleGenerativeAI };
});

import {
  _clearClientCache,
  callGemini,
  callGeminiStream,
  stripGemmaThinkingTokens,
} from "./gemini-adapter";
import { Message } from "../api/api";

const messages: Message[] = [
  { role: "system", content: "You are helpful." },
  { role: "user", content: "Hello" },
];

beforeEach(() => {
  _clearClientCache(); // Clean the map before every test
  vi.clearAllMocks();
});

describe("callGemini", () => {
  it("returns text from the Gemini response", async () => {
    const result = await callGemini("fake-key", "gemini-2.0-flash", messages);
    expect(result).toBe("Hello from Gemini");
  });

  it("throws if response text is empty", async () => {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");

    // Use 'function' here too
    (GoogleGenerativeAI as any).mockImplementationOnce(function () {
      return {
        getGenerativeModel: vi.fn().mockReturnValue({
          startChat: vi.fn().mockReturnValue({
            sendMessage: vi.fn().mockResolvedValue({
              response: { text: () => "" },
            }),
          }),
        }),
      };
    });

    await expect(
      callGemini("fake-key", "gemini-2.0-flash", messages),
    ).rejects.toThrow("empty response");
  });
});

describe("stripGemmaThinkingTokens", () => {
  it("strips a single thinking block", () => {
    const input =
      "<|channel>thought\nLet me think about this.\n<channel|>The answer is 42.";
    expect(stripGemmaThinkingTokens(input)).toBe("The answer is 42.");
  });

  it("strips a multi-line thinking block", () => {
    const input =
      "<|channel>thought\nLine one.\nLine two.\nLine three.\n<channel|>Final response.";
    expect(stripGemmaThinkingTokens(input)).toBe("Final response.");
  });

  it("returns the original string unchanged when no block is present", () => {
    const input = "feat: add login endpoint";
    expect(stripGemmaThinkingTokens(input)).toBe("feat: add login endpoint");
  });

  it("trims surrounding whitespace after stripping", () => {
    const input =
      "<|channel>thought\nThinking...\n<channel|>\n\nThe commit message.";
    expect(stripGemmaThinkingTokens(input).trim()).toBe("The commit message.");
  });
});

describe("callGeminiStream — Gemma 4 raw token guard", () => {
  it("strips raw channel token delimiters from streamed content chunks", async () => {
    async function* fakeStream() {
      yield {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "<|channel>thought\nPrivate reasoning.\n<channel|>chore: update dependencies",
                },
              ],
            },
          },
        ],
      };
    }

    const mockSendMessageStream = vi
      .fn()
      .mockResolvedValue({ stream: fakeStream() });
    const mockChat = { sendMessageStream: mockSendMessageStream };
    const mockModel = { startChat: vi.fn().mockReturnValue(mockChat) };
    const mockClient = {
      getGenerativeModel: vi.fn().mockReturnValue(mockModel),
    };

    // Need to access the internal mock import to set up the implementation
    const genai = await import("@google/generative-ai");
    vi.mocked(genai.GoogleGenerativeAI).mockImplementationOnce(function () {
      return mockClient as any;
    });

    const iterable = await callGeminiStream("key", "gemma-4-27b-it", [
      { role: "user", content: "Generate a commit message." },
    ]);

    const chunks: any[] = [];
    for await (const chunk of iterable) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0].delta.content).toBe(
      "chore: update dependencies",
    );
  });
});

describe("callGeminiStream", () => {
  it("yields normalized ChatCompletionChunk objects", async () => {
    const stream = await callGeminiStream(
      "fake-key",
      "gemini-2.0-flash",
      messages,
    );
    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk.choices[0].delta.content ?? "");
    }
    expect(chunks).toEqual(["chunk one", " chunk two"]);
  });

  it("throws AbortError when signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const stream = await callGeminiStream(
      "fake-key",
      "gemini-2.0-flash",
      messages,
      {},
      controller.signal,
    );
    await expect(async () => {
      for await (const _ of stream) {
        // should not reach here
      }
    }).rejects.toThrow("AbortError");
  });
});
