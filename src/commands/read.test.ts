import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as config from "../core/config";
import * as compactor from "../utils/compactor";
import * as readUtils from "../utils/read-utils";
import * as security from "../utils/security";
import { Logger } from "../utils/logger";
import { serializeMcpToolReply } from "../__tests__/mcp-response-test-utils";
import {
  boundReadResponse,
  getMinimumMcpReadResponseBudget,
  getReadContent,
  getReadOutcome,
  runRead,
} from "./read";

vi.mock("../core/config", () => ({
  getReadTokenLimit: vi.fn().mockReturnValue(1000),
  getCompactThreshold: vi.fn().mockReturnValue(2000),
  getEnv: vi.fn().mockResolvedValue({ SPEKTA_READ_TOKEN_LIMIT: "1000" }),
}));
vi.mock("../utils/read-utils");
vi.mock("../utils/security");
vi.mock("../utils/compactor", () => ({
  compactFile: vi.fn().mockReturnValue({
    content: "mocked compacted content",
    isCompacted: false,
  }),
}));
vi.mock("../editor-utils");
vi.mock("../utils/logger", () => ({
  Logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("runRead", () => {
  const mockGetReadTokenLimit = vi.mocked(config.getReadTokenLimit);
  const mockGetCompactThreshold = vi.mocked(config.getCompactThreshold);
  const mockGetFileLines = vi.mocked(readUtils.getFileLines);
  const mockGetTokenCount = vi.mocked(readUtils.getTokenCount);
  const mockValidatePathAccess = vi.mocked(security.validateReadPathAccess);
  const mockCompactFile = vi.mocked(compactor.compactFile);
  const mockLogger = vi.mocked(Logger);

  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReadTokenLimit.mockReturnValue(1000);
    mockGetCompactThreshold.mockReturnValue(2000);
    mockValidatePathAccess.mockImplementation((target) =>
      Promise.resolve(target),
    );
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("bounds the complete read response and labels retained content incomplete", () => {
    mockGetTokenCount.mockImplementation((text) => text.length);
    const largeFormattedRead = `#### sample.ts\n\`\`\`ts\n${"x".repeat(3000)}\n\`\`\`\n`;

    const outcome = boundReadResponse(largeFormattedRead);

    expect(outcome.status).toBe("output_limit_exceeded");
    if (outcome.status === "output_limit_exceeded") {
      expect(outcome.message.length).toBeLessThanOrEqual(1000);
      expect(outcome.message).toContain("[INCOMPLETE:");
    }
  });

  it("keeps exact-budget responses complete", () => {
    mockGetTokenCount.mockImplementation((text) => text.length);
    mockGetReadTokenLimit.mockReturnValue(6);
    expect(boundReadResponse("12345")).toEqual({
      status: "success",
      value: "12345",
    });
  });

  it.each([
    ["long line", `${"x".repeat(2000)}\n`],
    [
      "multiple files",
      `#### a.ts\n\`\`\`ts\n${"a".repeat(800)}\n\`\`\`\n#### b.ts\n\`\`\`ts\n${"b".repeat(800)}\n\`\`\`\n`,
    ],
    [
      "range metadata",
      `#### a.ts (lines 4-8 of 80)\n\`\`\`ts\n${"x".repeat(2000)}\n\`\`\`\n`,
    ],
    [
      "compaction advisory",
      `${"COMPACTION NOTICE ".repeat(30)}${"x".repeat(2000)}`,
    ],
  ])("marks %s responses incomplete", (_name, response) => {
    mockGetTokenCount.mockImplementation((text) => text.length);
    mockGetReadTokenLimit.mockReturnValue(1000);
    const outcome = boundReadResponse(response);
    expect(outcome.status).toBe("output_limit_exceeded");
    if (outcome.status === "output_limit_exceeded") {
      expect(outcome.message).toContain("[INCOMPLETE:");
      expect(outcome.message.length).toBeLessThanOrEqual(1000);
    }
  });

  it("accounts for request ID and MCP envelope overhead", () => {
    mockGetTokenCount.mockImplementation((text) => text.length);
    mockGetReadTokenLimit.mockReturnValue(30);
    const requestId = "request-with-long-id";
    const outcome = boundReadResponse("x".repeat(100), requestId);
    expect(outcome.status).toBe("output_limit_exceeded");
    if (outcome.status === "output_limit_exceeded") {
      const completeReply = serializeMcpToolReply(requestId, {
        isError: true,
        content: [{ type: "text", text: outcome.message }],
      });
      expect(mockGetTokenCount(completeReply)).toBeLessThanOrEqual(
        getMinimumMcpReadResponseBudget(requestId),
      );
    }
  });

  it("retains output-limit status when no incomplete text can fit", async () => {
    mockGetTokenCount.mockImplementation((text) => text.length);
    mockGetReadTokenLimit.mockReturnValue(0);
    mockGetFileLines.mockResolvedValue({ lines: ["read me"], total: 1 });
    const outcome = await getReadOutcome([{ path: "small.ts" }], true);
    expect(outcome).toEqual({ status: "output_limit_exceeded", message: "" });
  });

  it("raises tiny MCP budgets to fit the complete request-aware error reply", () => {
    mockGetTokenCount.mockImplementation((text) => text.length);
    mockGetReadTokenLimit.mockReturnValue(0);
    const requestId = `request-${"x".repeat(300)}`;
    const outcome = boundReadResponse("x".repeat(1000), requestId);

    expect(outcome.status).toBe("output_limit_exceeded");
    if (outcome.status !== "output_limit_exceeded") return;
    const completeReply = serializeMcpToolReply(requestId, {
      isError: true,
      content: [{ type: "text", text: outcome.message }],
    });
    expect(mockGetTokenCount(completeReply)).toBeLessThanOrEqual(
      getMinimumMcpReadResponseBudget(requestId),
    );
    expect(getMinimumMcpReadResponseBudget(requestId)).toBeGreaterThan(0);
  });

  it("bounds formatted multi-file reads and preserves their incomplete outcome", async () => {
    mockGetTokenCount.mockImplementation((text) => text.length);
    mockGetReadTokenLimit.mockReturnValue(1000);
    mockGetFileLines
      .mockResolvedValueOnce({ lines: ["a".repeat(700)], total: 1 })
      .mockResolvedValueOnce({ lines: ["b".repeat(700)], total: 1 });

    const outcome = await getReadOutcome(
      [{ path: "a.ts" }, { path: "b.ts" }],
      true,
    );

    expect(outcome.status).toBe("output_limit_exceeded");
    if (outcome.status === "output_limit_exceeded") {
      expect(outcome.message).toContain("a.ts");
      expect(outcome.message).toContain("[INCOMPLETE:");
      expect(outcome.message.length).toBeLessThanOrEqual(1000);
    }
  });

  it("bounds actual range output after range metadata is formatted", async () => {
    mockGetTokenCount.mockImplementation((text) => text.length);
    mockGetReadTokenLimit.mockReturnValue(1000);
    mockGetFileLines
      .mockResolvedValueOnce({ lines: ["x".repeat(1500)], total: 80 })
      .mockResolvedValueOnce({ lines: Array(80).fill("line"), total: 80 });

    const outcome = await getReadOutcome(
      [{ path: "a.ts", range: { start: 4, end: 8 } }],
      true,
    );

    expect(outcome.status).toBe("output_limit_exceeded");
    if (outcome.status === "output_limit_exceeded") {
      expect(outcome.message).toContain("lines 4-8 of 80");
      expect(outcome.message).toContain("[INCOMPLETE:");
    }
  });

  it("includes compaction advisory in the budgeted response", async () => {
    mockGetReadTokenLimit.mockReturnValue(1000);
    mockGetFileLines.mockResolvedValue({ lines: ["compacted"], total: 1 });
    mockGetTokenCount.mockImplementation((text) => text.length);
    mockGetCompactThreshold.mockReturnValue(2);
    mockCompactFile.mockReturnValue({
      content: "compacted",
      isCompacted: true,
    });

    const outcome = await getReadOutcome([{ path: "a.ts" }]);

    expect(outcome.status).toBe("success");
    if (outcome.status === "success") {
      expect(outcome.value).toContain("COMPACTION NOTICE");
      expect(outcome.value.length + 1).toBeLessThanOrEqual(1000);
    }
  });

  it("should provide raw output for targeted range requests even if long", async () => {
    // Range requests bypass the compaction gate entirely, so getTokenCount is
    // only called once — for the token-limit enforcement path.
    const longContent = "line\n".repeat(1000);
    mockGetFileLines.mockResolvedValue({
      lines: longContent.trim().split("\n"),
      total: 1000,
    });
    mockGetTokenCount.mockReturnValue(100);

    await runRead([{ path: "test.ts", range: { start: 1, end: 1000 } }]);

    expect(mockCompactFile).not.toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining(longContent.trim()),
    );
    expect(stdoutSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("[COMPACTED OVERVIEW]"),
    );
  });

  it("should error if a range request exceeds token limit", async () => {
    mockGetFileLines.mockResolvedValue({
      lines: ["large content"],
      total: 100,
    });
    mockGetTokenCount.mockReturnValue(3000); // 3000 > 1000 limit

    await runRead([{ path: "large.ts", range: { start: 1, end: 100 } }]);

    expect(mockLogger.error).toHaveBeenCalledWith(
      "Requested range for large.ts exceeds token limit (3000 > 1000).",
    );
    expect(stdoutSpy).toHaveBeenCalledWith("");
  });

  it("should utilize compaction for full-file reads", async () => {
    const longContent = "A".repeat(2500);
    mockGetFileLines.mockResolvedValue({
      lines: [longContent],
      total: 1,
    });
    mockCompactFile.mockReturnValue({
      content: "compacted content",
      isCompacted: true,
    });
    // First call: compaction gate check — must exceed the 2000 threshold.
    // Second call: token-limit enforcement on the compacted output.
    mockGetTokenCount.mockReturnValueOnce(2500).mockReturnValue(50);

    await runRead([{ path: "full.ts" }]);

    expect(mockCompactFile).toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining("compacted content"),
    );
  });

  it("should include total line count and token count in metadata for range requests", async () => {
    mockGetFileLines
      .mockResolvedValueOnce({
        lines: ["line 10", "line 11"],
        total: 500,
      })
      .mockResolvedValueOnce({
        lines: Array<string>(500).fill("line"),
        total: 500,
      });
    mockGetTokenCount.mockReturnValueOnce(10).mockReturnValueOnce(2000);

    await runRead([{ path: "test.ts", range: { start: 10, end: 11 } }]);

    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "#### test.ts (lines 10-11 of 500) [10/2,000 tokens]",
      ),
    );
  });

  it("should include token metadata in interactive range reads without enforcement", async () => {
    mockGetFileLines
      .mockResolvedValueOnce({
        lines: ["line 10", "line 11"],
        total: 500,
      })
      .mockResolvedValueOnce({
        lines: Array<string>(500).fill("line"),
        total: 500,
      });
    mockGetTokenCount.mockReturnValueOnce(10).mockReturnValueOnce(2000);

    await runRead([{ path: "test.ts", range: { start: 10, end: 11 } }], {
      interactive: true,
    });

    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "#### test.ts (lines 10-11 of 500) [10/2,000 tokens]",
      ),
    );
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it("should include total line count and token count in metadata for full-file reads", async () => {
    mockGetFileLines.mockResolvedValue({
      lines: ["line 1", "line 2"],
      total: 2,
    });
    mockGetTokenCount.mockReturnValue(150);
    mockCompactFile.mockReturnValue({
      content: "line 1\nline 2",
      isCompacted: false,
    });

    await runRead([{ path: "small.ts" }]);

    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "#### small.ts (lines 1-2 (Full File)) [150 tokens]",
      ),
    );
  });

  describe("interactive mode behavior", () => {
    it("should safely format full-file requests in interactive mode without range errors", async () => {
      mockGetFileLines.mockResolvedValue({
        lines: ["line 1", "line 2"],
        total: 2,
      });
      mockGetTokenCount.mockReturnValue(150);

      const output = await getReadContent([{ path: "small.ts" }], true);

      expect(output).toContain(
        "#### small.ts (lines 1-2 (Full File)) [150 tokens]",
      );
      expect(output).not.toContain("ERROR");
    });

    it("should calculate tokens for interactive output without enforcing the limit", async () => {
      const content = "line 1\nline 2";
      mockGetFileLines.mockResolvedValue({
        lines: content.split("\n"),
        total: 2,
      });
      mockGetTokenCount.mockReturnValue(150);

      await runRead([{ path: "small.ts" }], { interactive: true });

      expect(mockGetTokenCount).toHaveBeenCalledWith(content);
      expect(stdoutSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "#### small.ts (lines 1-2 (Full File)) [150 tokens]",
        ),
      );
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it("should retain token counting and enforcement in non-interactive mode", async () => {
      mockGetFileLines.mockResolvedValue({
        lines: Array<string>(1000).fill("large content line"),
        total: 1000,
      });
      // First call: compaction gate — exceeds threshold so compactFile runs.
      // Second call: token-limit enforcement on the (un-compacted) output.
      mockGetTokenCount.mockReturnValueOnce(2500).mockReturnValue(3000);
      mockCompactFile.mockReturnValue({
        content: Array(1000).fill("large content line").join("\n"),
        isCompacted: false,
      });

      await runRead([{ path: "large.ts" }], { interactive: false });

      expect(mockGetTokenCount).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("large.ts exceeds token limit (3000 > 1000)"),
      );
    });

    it("should never compact in interactive mode", async () => {
      const content = "line\n".repeat(1000).trim();
      mockGetFileLines.mockResolvedValue({
        lines: content.split("\n"),
        total: 1000,
      });
      mockGetTokenCount.mockReturnValue(2500);
      mockCompactFile.mockReturnValue({
        content: "compacted content",
        isCompacted: true,
      });

      await runRead([{ path: "large.ts" }], { interactive: true });

      expect(mockGetTokenCount).toHaveBeenCalledWith(content);
      expect(mockCompactFile).not.toHaveBeenCalled();
      expect(stdoutSpy).toHaveBeenCalledWith("");
    });
  });

  describe("compaction advisory preservation", () => {
    it("should not show compaction advisory in interactive mode", async () => {
      const content = Array(1000).fill("line").join("\n");
      mockGetFileLines.mockResolvedValue({
        lines: content.split("\n"),
        total: 1000,
      });
      mockGetTokenCount.mockReturnValue(2500);

      await runRead([{ path: "large.ts" }], { interactive: true });

      expect(mockCompactFile).not.toHaveBeenCalled();
      expect(stdoutSpy).toHaveBeenCalledWith(
        expect.not.stringContaining("COMPACTION NOTICE"),
      );
    });

    it("should not show compaction advisory when no compaction occurs", async () => {
      const smallContent = "line 1\nline 2";
      mockGetFileLines.mockResolvedValue({
        lines: smallContent.trim().split("\n"),
        total: 2,
      });
      mockCompactFile.mockReturnValue({
        content: smallContent,
        isCompacted: false,
      });
      mockGetTokenCount.mockReturnValue(5);

      await runRead([{ path: "small.ts" }], { interactive: true });

      expect(stdoutSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("COMPACTION NOTICE"),
      );
    });

    it("should show compaction advisory in non-interactive mode when compaction occurs", async () => {
      const longContent = "line\n".repeat(1000);
      mockGetFileLines.mockResolvedValue({
        lines: longContent.trim().split("\n"),
        total: 1000,
      });
      mockCompactFile.mockReturnValue({
        content: "compacted content",
        isCompacted: true,
      });
      mockGetTokenCount.mockReturnValueOnce(2500).mockReturnValue(50);

      await runRead([{ path: "large.ts" }], { interactive: false });

      expect(stdoutSpy).toHaveBeenCalledWith(
        expect.stringContaining("COMPACTION NOTICE"),
      );
    });
  });
});
