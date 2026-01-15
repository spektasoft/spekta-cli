import { describe, it, expect, vi } from "vitest";
import { executeAiAction } from "../src/orchestrator";
import * as api from "../src/api";

vi.mock("../src/api");

describe("Orchestrator Role Validation", () => {
  it("should pass structured system and user messages to the API client", async () => {
    const callSpy = vi.spyOn(api, "callAI").mockResolvedValue("result");

    await executeAiAction({
      apiKey: "test-key",
      provider: { name: "test", model: "gpt-4", config: {} },
      messages: [
        { role: "system", content: "sys-prompt" },
        { role: "user", content: "user-context" },
      ],
      spinnerTitle: "test",
    });

    expect(callSpy).toHaveBeenCalledWith(
      "test-key",
      "gpt-4",
      [
        { role: "system", content: "sys-prompt" },
        { role: "user", content: "user-context" },
      ],
      {}
    );
  });
});
