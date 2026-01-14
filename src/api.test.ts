import { describe, it, expect, vi } from "vitest";
import { callAI } from "./api";
import OpenAI from "openai";

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

    const result = await callAI("key", "model", "prompt", {}, mockClient);
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

    await expect(
      callAI("key", "model", "prompt", {}, mockClient)
    ).rejects.toThrow("The AI provider returned an empty response.");
  });
});
