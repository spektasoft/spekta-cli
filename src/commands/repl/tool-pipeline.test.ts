import { afterAll, describe, expect, it, vi, beforeEach } from "vitest";
import { coordinateToolCalls, sanitizeToolContent } from "./tool-pipeline";
import { parseToolCalls, executeTool } from "../../utils/agent-utils";
import { checkbox } from "@inquirer/prompts";

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

vi.mock("../../utils/agent-utils");
vi.mock("@inquirer/prompts");

describe("tool-pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves proposed-tool and result box layouts at common terminal widths", async () => {
    expect(process.env.FORCE_COLOR).toBe("0");
    expect(process.env.NO_COLOR).toBeUndefined();
    const originalColumns = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

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
