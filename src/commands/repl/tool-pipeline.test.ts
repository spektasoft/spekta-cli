import { describe, expect, it, vi, beforeEach } from "vitest";
import { coordinateToolCalls, sanitizeToolContent } from "./tool-pipeline";
import { parseToolCalls, executeTool } from "../../utils/agent-utils";
import { checkbox } from "@inquirer/prompts";

vi.mock("../../utils/agent-utils");
vi.mock("@inquirer/prompts");

describe("tool-pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sanitizes interruption marker from assistant content", () => {
    const raw = "File content\n\n[Response interrupted by user]";
    expect(sanitizeToolContent(raw, true)).toBe("File content");
    expect(sanitizeToolContent(raw, false)).toBe(raw);
  });

  it("coordinates tool execution when user approves tools", async () => {
    vi.mocked(parseToolCalls).mockReturnValueOnce([
      { type: "write", path: "test.ts", content: "data", raw: "" },
    ]);
    vi.mocked(checkbox).mockResolvedValueOnce([0]);
    vi.mocked(executeTool).mockResolvedValueOnce("File written");

    const result = await coordinateToolCalls("write test.ts", false);

    expect(executeTool).toHaveBeenCalledWith({
      type: "write",
      path: "test.ts",
      content: "data",
      raw: "",
    });
    expect(result.shouldAutoTriggerAI).toBe(true);
    expect(result.pendingToolResults).toContain("Status: Success");
    expect(result.pendingToolResults).toContain("File written");
  });

  it("handles unselected tools as denied and avoids triggering AI", async () => {
    vi.mocked(parseToolCalls).mockReturnValueOnce([
      { type: "write", path: "test.ts", content: "data", raw: "" },
    ]);
    vi.mocked(checkbox).mockResolvedValueOnce([]);

    const result = await coordinateToolCalls("write test.ts", false);

    expect(executeTool).not.toHaveBeenCalled();
    expect(result.shouldAutoTriggerAI).toBe(false);
    expect(result.pendingToolResults).toContain("Status: Denied by user");
  });

  it("returns immediately without prompting when no tool calls are detected", async () => {
    vi.mocked(parseToolCalls).mockReturnValueOnce([]);

    const result = await coordinateToolCalls("plain chat response", false);

    expect(checkbox).not.toHaveBeenCalled();
    expect(result.pendingToolResults).toBe("");
    expect(result.shouldAutoTriggerAI).toBe(false);
  });
});
