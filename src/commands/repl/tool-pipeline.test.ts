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

  it("preserves proposed-tool and result box layouts at common terminal widths", async () => {
    const originalColumns = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns",
    );
    const originalForceColor = process.env.FORCE_COLOR;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.FORCE_COLOR = "0";

    try {
      for (const width of [40, 80, 120]) {
        Object.defineProperty(process.stdout, "columns", {
          configurable: true,
          value: width,
        });
        logSpy.mockClear();
        vi.mocked(parseToolCalls).mockReturnValueOnce([
          {
            type: "write",
            path: "src/example-file.ts",
            content: "data",
            raw: "",
          },
        ]);
        vi.mocked(checkbox).mockResolvedValueOnce([0]);
        vi.mocked(executeTool).mockResolvedValueOnce(
          "first result line\nsecond result line",
        );

        await coordinateToolCalls("write src/example-file.ts", false);

        const proposedBox = String(logSpy.mock.calls[0][0]);
        const resultBox = String(logSpy.mock.calls[1][0]);
        for (const box of [proposedBox, resultBox]) {
          const lines = box.trimEnd().split("\n");
          expect(lines[0]).toMatch(/^┌/);
          expect(lines.at(-1)).toMatch(/┘$/);
          expect(new Set(lines.map((line) => line.length)).size).toBe(1);
          expect(lines.every((line) => line.length <= width)).toBe(true);
          expect(box.includes(`${String.fromCharCode(27)}[`)).toBe(false);
        }
        expect(proposedBox).toContain("Proposed Tools");
        expect(proposedBox).toContain("src/example-file.ts");
        expect(resultBox).toContain("Tools Result");
        expect(resultBox).toContain("Status: Success");
        expect(resultBox).toContain("first result line");
        expect(resultBox).toContain("second result line");
      }
    } finally {
      if (originalColumns) {
        Object.defineProperty(process.stdout, "columns", originalColumns);
      } else {
        delete (process.stdout as NodeJS.WriteStream & { columns?: number })
          .columns;
      }
      if (originalForceColor === undefined) {
        delete process.env.FORCE_COLOR;
      } else {
        process.env.FORCE_COLOR = originalForceColor;
      }
      logSpy.mockRestore();
    }
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
