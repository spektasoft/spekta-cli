import { describe, expect, it, vi } from "vitest";
import { consumeAssistantStream } from "./stream-consumer";
import { ChatCompletionChunkWithReasoning } from "../../api/api";

async function* createMockStream(
  chunks: Array<{ content?: string; reasoning?: string }>,
): AsyncIterable<ChatCompletionChunkWithReasoning> {
  for (const chunk of chunks) {
    yield {
      id: "mock-chunk",
      object: "chat.completion.chunk",
      created: Date.now(),
      model: "mock-model",
      choices: [
        {
          index: 0,
          delta: {
            content: chunk.content,
            reasoning_details: chunk.reasoning
              ? [{ type: "text", text: chunk.reasoning }]
              : undefined,
          },
          finish_reason: null,
        },
      ],
    };
  }
}

describe("consumeAssistantStream", () => {
  it("consumes stream chunks, displays reasoning, and aggregates content", async () => {
    const stream = createMockStream([
      { reasoning: "Thinking through problem" },
      { content: "Hello " },
      { content: "world!" },
    ]);

    const mockSpinner = {
      start: vi.fn().mockReturnThis(),
      stop: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
    };

    const stdoutMock = {
      write: vi.fn(),
    };

    const result = await consumeAssistantStream(stream, {
      spinner: mockSpinner as never,
      stdout: stdoutMock,
    });

    expect(result.content).toBe("Hello world!");
    expect(result.reasoning).toBe("Thinking through problem");
    expect(result.interrupted).toBe(false);
    expect(mockSpinner.stop).toHaveBeenCalled();
    expect(stdoutMock.write).toHaveBeenCalledWith("Hello ");
    expect(stdoutMock.write).toHaveBeenCalledWith("world!");
  });

  it("handles AbortError during streaming gracefully and flags interruption", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";

    const throwingStream: AsyncIterable<ChatCompletionChunkWithReasoning> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            return Promise.reject(abortError);
          },
        };
      },
    };

    const mockSpinner = {
      start: vi.fn().mockReturnThis(),
      stop: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
    };

    const stdoutMock = {
      write: vi.fn(),
    };

    const result = await consumeAssistantStream(throwingStream, {
      spinner: mockSpinner as never,
      stdout: stdoutMock,
    });

    expect(result.interrupted).toBe(true);
    expect(mockSpinner.stop).toHaveBeenCalled();
    expect(stdoutMock.write).toHaveBeenCalledWith(
      expect.stringContaining("[Interrupted by user]"),
    );
  });
});
