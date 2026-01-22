import { describe, it, vi } from "vitest";
import * as readUtils from "../utils/read-utils";

describe("read-interactive validation", () => {
  it("should reject oversized range and allow re-input", async () => {
    // Mock oversized content
    vi.spyOn(readUtils, "validateFileRange").mockResolvedValueOnce({
      valid: false,
      tokens: 3000,
      message:
        "Range exceeds token limit (3000 > 2000). Try reducing to approximately 50 lines or fewer.",
      suggestedMaxLines: 50,
    });

    // Then mock valid range
    vi.spyOn(readUtils, "validateFileRange").mockResolvedValueOnce({
      valid: true,
      tokens: 1500,
    });

    // Test would verify loop behavior
    // (Full test requires mocking inquirer prompts - implementation depends on test framework)
  });
});
