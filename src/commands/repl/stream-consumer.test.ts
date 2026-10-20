import { afterAll, describe, expect, it, vi } from "vitest";

const originalColorEnvironment = vi.hoisted(() => {
  const original = Object.fromEntries(
    ["FORCE_COLOR", "NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE"].map((name) => [
      name,
      process.env[name],
    ]),
  ) as Record<string, string | undefined>;
  const enabled = process.env.SPEKTA_REPL_COLOR_POLICY === "enabled";

  process.env.FORCE_COLOR = enabled ? "1" : "0";
  delete process.env.NO_COLOR;
  delete process.env.CLICOLOR;
  delete process.env.CLICOLOR_FORCE;

  return original;
});

afterAll(() => {
  for (const [name, value] of Object.entries(originalColorEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});
import { consumeAssistantStream } from "./stream-consumer";
import { ChatCompletionChunkWithReasoning } from "../../api/api";
import { parseToolCalls } from "../../utils/agent-utils";

async function* createMockStream(
  chunks: Array<{ content?: string; reasoning?: string }>,
): AsyncIterable<ChatCompletionChunkWithReasoning> {
  await Promise.resolve();
  for (const chunk of chunks) {
    yield {
      choices: [
        {
          delta: {
            content: chunk.content ?? "",
            reasoning_details: chunk.reasoning
              ? [{ text: chunk.reasoning }]
              : undefined,
          },
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

  it("keeps streamed output ANSI-free when color is disabled", async () => {
    expect(process.env.FORCE_COLOR).toBe("0");
    expect(process.env.NO_COLOR).toBeUndefined();
    const stdoutMock = { write: vi.fn() };
    const mockSpinner = {
      start: vi.fn().mockReturnThis(),
      stop: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
    };

    const result = await consumeAssistantStream(
      createMockStream([{ reasoning: "thinking" }, { content: "answer" }]),
      { spinner: mockSpinner as never, stdout: stdoutMock },
    );
    const output = stdoutMock.write.mock.calls.join("");

    expect(output).toContain("Assistant:\n");
    expect(output).toContain("Thought:\n");
    expect(output).toContain("thinking");
    expect(output).toContain("answer");
    expect(output.includes(`${String.fromCharCode(27)}[`)).toBe(false);
    expect(result.content).toBe("answer");
    expect(result.reasoning).toBe("thinking");
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

  it("assembles streamed tool markup across chunks before parsing tool calls", async () => {
    const toolMarkup = [
      '<write path="src/generated.ts">',
      "export const answer = 42;",
      "</write>",
    ];
    const result = await consumeAssistantStream(
      createMockStream(toolMarkup.map((content) => ({ content }))),
      {
        spinner: { stop: vi.fn() } as never,
        stdout: { write: vi.fn() },
      },
    );

    expect(result.content).toBe(toolMarkup.join(""));
    expect(parseToolCalls(result.content)).toEqual([
      {
        type: "write",
        path: "src/generated.ts",
        content: "export const answer = 42;",
        raw: '<write path="src/generated.ts">export const answer = 42;</write>',
      },
    ]);
  });

  it("accepts empty-choice chunks and returns assembled text when the stream completes", async () => {
    let completed = false;
    async function* stream(): AsyncIterable<unknown> {
      await Promise.resolve();
      yield { choices: [] };
      yield {
        choices: [
          { delta: { content: "final answer" }, finish_reason: "stop" },
        ],
      };
      completed = true;
    }

    const result = await consumeAssistantStream(stream(), {
      spinner: { stop: vi.fn() } as never,
      stdout: { write: vi.fn() },
    });

    expect(completed).toBe(true);
    expect(result).toEqual({
      content: "final answer",
      reasoning: "",
      interrupted: false,
    });
  });
});
