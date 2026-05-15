import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as config from "../core/config";
import * as editorUtils from "../utils/editor-utils";
import * as compactor from "../utils/compactor";
import * as readUtils from "../utils/read-utils";
import * as security from "../utils/security";
import { Logger } from "../utils/logger";
import { getReadContent, runRead } from "./read";

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
  const mockGetEnv = vi.mocked(config.getEnv);
  const mockGetFileLines = vi.mocked(readUtils.getFileLines);
  const mockGetTokenCount = vi.mocked(readUtils.getTokenCount);
  const mockValidatePathAccess = vi.mocked(security.validatePathAccess);
  const mockCompactFile = vi.mocked(compactor.compactFile);
  const mockProcessOutput = vi.mocked(editorUtils.processOutput);
  const mockLogger = vi.mocked(Logger);

  let stdoutSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReadTokenLimit.mockReturnValue(1000);
    mockGetCompactThreshold.mockReturnValue(2000);
    mockValidatePathAccess.mockResolvedValue(undefined);
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining("#### large.ts ERROR"),
    );
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

  it("should include total line count in metadata for range requests", async () => {
    mockGetFileLines.mockResolvedValue({
      lines: ["line 10", "line 11"],
      total: 500,
    });
    mockGetTokenCount.mockReturnValue(10);

    await runRead([{ path: "test.ts", range: { start: 10, end: 11 } }]);

    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining("#### test.ts (lines 10-11 of 500)"),
    );
  });

  it("should include total line count in metadata for full-file reads", async () => {
    mockGetFileLines.mockResolvedValue({
      lines: ["line 1", "line 2"],
      total: 2,
    });
    // Small file: compaction gate returns a value below the 2000 threshold,
    // so compactFile is not called. Token-limit enforcement follows.
    mockGetTokenCount
      .mockReturnValueOnce(5) // compaction gate: below threshold → no compaction
      .mockReturnValue(5); // token-limit enforcement: well within limit
    mockCompactFile.mockReturnValue({
      content: "line 1\nline 2",
      isCompacted: false,
    });

    await runRead([{ path: "small.ts" }]);

    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining("#### small.ts (lines 1-2 (Full File))"),
    );
  });

  describe("interactive mode behavior", () => {
    it("should skip token counting entirely in interactive mode", async () => {
      const longContent = "line\n".repeat(1000);
      mockGetFileLines.mockResolvedValue({
        lines: longContent.trim().split("\n"),
        total: 1000,
      });
      mockCompactFile.mockReturnValue({
        content: "compacted content",
        isCompacted: true,
      });
      // getTokenCount drives the compaction gate; interactive mode must NOT
      // call it for either the gate or the enforcement path.
      // We do NOT set up mockGetTokenCount — any call would be a test failure.

      await runRead([{ path: "large.ts" }], { interactive: true });

      expect(mockGetTokenCount).not.toHaveBeenCalled();
    });

    it("should retain token counting and enforcement in non-interactive mode", async () => {
      mockGetFileLines.mockResolvedValue({
        lines: Array(1000).fill("large content line"),
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

    it("should still apply compaction in interactive mode", async () => {
      const longContent = "line\n".repeat(1000);
      mockGetFileLines.mockResolvedValue({
        lines: longContent.trim().split("\n"),
        total: 1000,
      });
      mockCompactFile.mockReturnValue({
        content: "compacted content",
        isCompacted: true,
      });
      // Interactive mode still evaluates the compaction gate via getTokenCount.
      // It must NOT call getTokenCount for the token-limit enforcement path.
      mockGetTokenCount.mockReturnValueOnce(2500);

      await runRead([{ path: "large.ts" }], { interactive: true });

      expect(mockCompactFile).toHaveBeenCalled();
      expect(mockGetTokenCount).not.toHaveBeenCalledTimes(2);
    });
  });

  describe("compaction advisory preservation", () => {
    it("should show compaction advisory in interactive mode when compaction occurs", async () => {
      mockGetFileLines.mockResolvedValue({
        lines: Array(1000).fill("line"),
        total: 1000,
      });
      mockCompactFile.mockReturnValue({
        content: "compacted content",
        isCompacted: true,
      });
      // Compaction gate must fire.
      mockGetTokenCount.mockReturnValueOnce(2500);

      await runRead([{ path: "large.ts" }], { interactive: true });

      expect(stdoutSpy).toHaveBeenCalledWith(
        expect.stringContaining("COMPACTION NOTICE"),
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
      // Compaction gate must NOT fire.
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
      // First call: compaction gate — fires.
      // Second call: token-limit enforcement on compacted output — within limit.
      mockGetTokenCount.mockReturnValueOnce(2500).mockReturnValue(50);

      await runRead([{ path: "large.ts" }], { interactive: false });

      expect(stdoutSpy).toHaveBeenCalledWith(
        expect.stringContaining("COMPACTION NOTICE"),
      );
    });
  });

  describe("getReadContent non-interactive mode behavior preservation", () => {
    beforeEach(() => {
      vi.resetAllMocks();
      mockGetReadTokenLimit.mockReturnValue(1000);
      mockGetCompactThreshold.mockReturnValue(2000);
      mockGetEnv.mockResolvedValue({ SPEKTA_READ_TOKEN_LIMIT: "1000" });
      mockValidatePathAccess.mockResolvedValue(undefined);
      mockCompactFile.mockReturnValue({
        content: "mocked compacted content",
        isCompacted: false,
      });
    });

    it("non-interactive mode blocks range requests exceeding token limit", async () => {
      mockGetFileLines
        .mockResolvedValueOnce({
          lines: ["console.log('hello');"],
          total: 1,
        })
        .mockResolvedValueOnce({
          lines: Array(1000).fill("console.log('line');"),
          total: 1000,
        });

      // Range requests skip the compaction gate, so getTokenCount is called
      // exactly once per file — purely for token-limit enforcement.
      mockGetTokenCount
        .mockReturnValueOnce(50) // small.ts: within limit
        .mockReturnValueOnce(1500); // large.ts: exceeds 1000 limit

      const mockRequests = [
        { path: "small.ts", range: { start: 1, end: 10 } },
        { path: "large.ts", range: { start: 1, end: 1000 } },
      ];

      const output = await getReadContent(mockRequests, false);

      expect(output).toContain("small.ts");
      expect(output).toContain("large.ts ERROR");
      expect(output).toContain(
        "Requested range for large.ts exceeds token limit (1500 > 1000).",
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Requested range for large.ts exceeds token limit (1500 > 1000).",
      );
    });

    it("non-interactive mode warns for full files exceeding limit without compaction", async () => {
      mockGetFileLines.mockResolvedValue({
        lines: Array(200).fill(
          "console.log('line with long text that exceeds typical compaction threshold');",
        ),
        total: 200,
      });
      // First call: compaction gate — fires, but compactFile returns isCompacted: false.
      // Second call: token-limit enforcement — exceeds limit, warning issued.
      mockGetTokenCount.mockReturnValueOnce(2500).mockReturnValue(2000);
      mockCompactFile.mockReturnValue({
        content: Array(200)
          .fill(
            "console.log('line with long text that exceeds typical compaction threshold');",
          )
          .join("\n"),
        isCompacted: false,
      });

      const mockRequests = [{ path: "uncompactable-large.ts" }];
      const output = await getReadContent(mockRequests, false);

      expect(output).toContain("[EXCEEDS TOKEN LIMIT]");
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "uncompactable-large.ts exceeds token limit (2000 > 1000) and could not be compacted.",
      );
    });

    it("end-to-end non-interactive read command preserves original behavior", async () => {
      mockGetFileLines
        .mockResolvedValueOnce({
          lines: ["console.log('small');"],
          total: 1,
        })
        .mockResolvedValueOnce({
          lines: Array(100).fill("console.log('medium');"),
          total: 100,
        })
        .mockResolvedValueOnce({
          lines: Array(1000).fill("console.log('large');"),
          total: 1000,
        });

      // Call sequence for three files:
      //   small.ts  (full file): gate=10 (no compact), enforce=10 (ok)
      //   medium.ts (range):     enforce=500 (ok)          [no gate call — range request]
      //   large.ts  (full file): gate=2500 (compact fires, isCompacted:false), enforce=2000 (warn)
      mockGetTokenCount
        .mockReturnValueOnce(10) // small.ts — gate
        .mockReturnValueOnce(10) // small.ts — enforce
        .mockReturnValueOnce(500) // medium.ts — enforce (range, no gate)
        .mockReturnValueOnce(2500) // large.ts — gate
        .mockReturnValueOnce(2000); // large.ts — enforce

      mockCompactFile
        .mockReturnValueOnce({
          content: "console.log('small');",
          isCompacted: false,
        })
        .mockReturnValueOnce({
          content: Array(1000).fill("console.log('large');").join("\n"),
          isCompacted: false,
        });

      const mockRequests = [
        { path: "small.ts" },
        { path: "medium.ts", range: { start: 1, end: 50 } },
        { path: "large.ts" },
      ];

      const output = await getReadContent(mockRequests, false);

      expect(output).toContain("small.ts (lines 1-1 (Full File))");
      expect(output).toContain("console.log('small');");

      expect(output).toContain("medium.ts (lines 1-50 of 100)");
      expect(output).toContain("console.log('medium');");

      expect(output).toContain("[EXCEEDS TOKEN LIMIT]");
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "large.ts exceeds token limit (2000 > 1000) and could not be compacted.",
      );

      expect(output).not.toContain("COMPACTION NOTICE");
    });
  });
});
