import { describe, it, expect, vi } from "vitest";
import { executeAiAction } from "./orchestrator";
import * as api from "../api/api";

vi.mock("../src/api");

describe("Orchestrator Role Validation", () => {
  it("should pass structured system and user messages to the API client", async () => {
    const callSpy = vi
      .spyOn(api, "callAIWithProvider")
      .mockResolvedValue("result");

    await executeAiAction({
      provider: { name: "test", model: "gpt-4", config: {} },
      messages: [
        { role: "system", content: "sys-prompt" },
        { role: "user", content: "user-context" },
      ],
      spinnerTitle: "test",
    });

    expect(callSpy).toHaveBeenCalledWith(
      { name: "test", model: "gpt-4", config: {} },
      [
        { role: "system", content: "sys-prompt" },
        { role: "user", content: "user-context" },
      ],
      {},
    );
  });
});
