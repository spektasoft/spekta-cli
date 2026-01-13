import { describe, it, expect, vi, beforeEach } from "vitest";
import { callAI } from "./api";
import OpenAI from "openai";

vi.mock("openai");

describe("callAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns content on successful API call", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "Refactored code" } }],
    });

    vi.mocked(OpenAI).prototype.chat = {
      completions: { create: mockCreate },
    } as any;

    const result = await callAI("test-key", "test-model", "test-prompt");
    expect(result).toBe("Refactored code");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        messages: [{ role: "user", content: "test-prompt" }],
      })
    );
  });

  it("throws specific error when AI returns null content", async () => {
    vi.mocked(OpenAI).prototype.chat = {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: null } }],
        }),
      },
    } as any;

    await expect(callAI("key", "model", "prompt")).rejects.toThrow(
      "The AI provider returned an empty response."
    );
  });
});
