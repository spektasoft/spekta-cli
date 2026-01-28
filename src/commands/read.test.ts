import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as config from "../config";
import * as editorUtils from "../editor-utils";
import * as compactor from "../utils/compactor";
import * as readUtils from "../utils/read-utils";
import * as security from "../utils/security";
import { Logger } from "../utils/logger";
import { getReadContent, runRead } from "./read";

vi.mock("../config");
vi.mock("../utils/read-utils");
vi.mock("../utils/security");
vi.mock("../utils/compactor", () => ({
  compactFile: vi.fn().mockReturnValue({
    content: "mocked compacted content",
    isCompacted: false,
  }),
}));
vi.mock("../editor-utils");
vi.mock("../utils/logger");

describe("runRead", () => {
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
    mockGetEnv.mockResolvedValue({ SPEKTA_READ_TOKEN_LIMIT: "1000" });
    mockValidatePathAccess.mockResolvedValue(undefined);
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should provide raw output for targeted range requests even if long", async () => {
    // 1. Create a test case where a specific lineRange is requested for a file that would normally trigger compaction.
    // Verify that the output is provided raw (no collapsed lines).

    const longContent = "line\n".repeat(1000); // 5000 chars, > 2000 CHAR_THRESHOLD
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
    // 2. Create a test case where a lineRange is requested that spans 3,000 tokens (with a limit of 2,000).
    // Verify that the system provides an error message instead of a compacted file.

    mockGetFileLines.mockResolvedValue({
      lines: ["large file content"],
      total: 100,
    });
    mockGetTokenCount.mockReturnValue(3000);

    await runRead([{ path: "large.ts", range: { start: 1, end: 100 } }]);

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("exceeds token limit (3000 > 1000)"),
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Error: Requested range for large.ts exceeds token limit (3000 > 1000)",
      ),
    );
    expect(mockCompactFile).not.toHaveBeenCalled();
  });

  it("should utilize compaction for full-file reads", async () => {
    // 3. Verify that full-file reads (no lineRange) still utilize compaction as expected.

    const longContent = "line\n".repeat(1000);
    mockGetFileLines.mockResolvedValue({
      lines: longContent.trim().split("\n"),
      total: 1000,
    });
    mockCompactFile.mockReturnValue({
      content: "compacted content",
      isCompacted: true,
    });
    mockGetTokenCount.mockReturnValue(50);

    await runRead([{ path: "full.ts" }]);

    expect(mockCompactFile).toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining("compacted content"),
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining("[COMPACTED OVERVIEW]"),
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
    mockGetTokenCount.mockReturnValue(5);

    await runRead([{ path: "small.ts" }]);

    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining("#### small.ts (lines 1-2 (Full File))"),
    );
  });

  describe("interactive mode behavior", () => {
    it("should skip token counting entirely in interactive mode", async () => {
      // Test that interactive mode doesn't call getTokenCount at all
      const longContent = "line\n".repeat(1000);
      mockGetFileLines.mockResolvedValue({
        lines: longContent.trim().split("\n"),
        total: 1000,
      });
      // Don't mock getTokenCount - if it's called, the test will fail
      mockGetTokenCount.mockReturnValue(3000);

      await runRead([{ path: "large.ts" }], { interactive: true });

      // In interactive mode, getTokenCount should NOT be called
      expect(mockGetTokenCount).not.toHaveBeenCalled();
    });

    it("should retain token counting and enforcement in non-interactive mode", async () => {
      // Test that non-interactive mode still calls getTokenCount and enforces limits
      mockGetFileLines.mockResolvedValue({
        lines: ["large content"],
        total: 100,
      });
      mockGetTokenCount.mockReturnValue(3000);

      await runRead([{ path: "large.ts" }], { interactive: false });

      // Non-interactive mode MUST call getTokenCount
      expect(mockGetTokenCount).toHaveBeenCalled();
      // And should still enforce limits
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("exceeds token limit (3000 > 1000)"),
      );
    });

    it("should still apply compaction in interactive mode", async () => {
      // Test that compaction works in interactive mode
      const longContent = "line\n".repeat(1000);
      mockGetFileLines.mockResolvedValue({
        lines: longContent.trim().split("\n"),
        total: 1000,
      });
      mockCompactFile.mockReturnValue({
        content: "compacted content",
        isCompacted: true,
      });
      // Don't mock getTokenCount for interactive mode

      await runRead([{ path: "large.ts" }], { interactive: true });

      // Compaction should still happen
      expect(mockCompactFile).toHaveBeenCalled();
      // But token counting should not
      expect(mockGetTokenCount).not.toHaveBeenCalled();
    });
  });

  describe("compaction advisory preservation", () => {
    it("should show compaction advisory in interactive mode when compaction occurs", async () => {
      mockGetFileLines.mockResolvedValue({
        lines: Array(1000).fill("line"),
        total: 1000,
      });

      // Explicitly set the mock state for this specific test case
      mockCompactFile.mockReturnValue({
        content: "compacted content",
        isCompacted: true,
      });

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
      mockGetTokenCount.mockReturnValue(50);

      await runRead([{ path: "large.ts" }], { interactive: false });

      expect(stdoutSpy).toHaveBeenCalledWith(
        expect.stringContaining("COMPACTION NOTICE"),
      );
    });
  });

  describe("getReadContent non-interactive mode behavior preservation", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockGetEnv.mockResolvedValue({ SPEKTA_READ_TOKEN_LIMIT: "1000" });
      mockValidatePathAccess.mockResolvedValue(undefined);

      // Ensure compactFile is properly mocked
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
        }) // small.ts
        .mockResolvedValueOnce({
          lines: [
            "console.log('hello');",
            ...Array(999).fill("console.log('line');"),
          ],
          total: 1000,
        }); // large.ts

      mockGetTokenCount
        .mockReturnValueOnce(50) // small.ts
        .mockReturnValueOnce(1500); // large.ts (exceeds 1000 limit)

      const mockRequests = [
        { path: "small.ts", range: { start: 1, end: 10 } }, // Under limit
        { path: "large.ts", range: { start: 1, end: 10000 } }, // Exceeds limit
      ];

      const output = await getReadContent(mockRequests, false);

      expect(output).toContain("small.ts");
      expect(output).toContain("large.ts ERROR");
      expect(output).toContain(
        "Requested range for large.ts exceeds token limit (1500 > 1000)",
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "Requested range for large.ts exceeds token limit",
        ),
      );
    });

    it("non-interactive mode warns for full files exceeding limit without compaction", async () => {
      // Mock getFileLines to return content >500 chars but not compactable
      mockGetFileLines.mockResolvedValue({
        lines: Array(200).fill(
          "console.log('line with long text that exceeds typical compaction threshold');",
        ),
        total: 200,
      });
      mockGetTokenCount.mockReturnValue(2000); // Exceeds limit

      const mockRequests = [{ path: "uncompactable-large.ts" }];
      const output = await getReadContent(mockRequests, false);

      expect(output).toContain("[EXCEEDS TOKEN LIMIT]");
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "uncompactable-large.ts exceeds token limit (2000 > 1000) and could not be compacted",
        ),
      );
    });

    it("end-to-end non-interactive read command preserves original behavior", async () => {
      // Mock different file sizes with proper getFileLines response format
      mockGetFileLines
        .mockResolvedValueOnce({
          lines: ["console.log('small');"],
          total: 1,
        }) // Small file
        .mockResolvedValueOnce({
          lines: Array(100).fill("console.log('medium');"),
          total: 100,
        }) // Medium file
        .mockResolvedValueOnce({
          lines: Array(1000).fill("console.log('large');"),
          total: 1000,
        }); // Large file

      mockGetTokenCount
        .mockReturnValueOnce(10) // Small file
        .mockReturnValueOnce(500) // Medium file
        .mockReturnValueOnce(2000); // Large file

      const mockRequests = [
        { path: "small.ts" }, // Should process normally
        { path: "medium.ts", range: { start: 1, end: 50 } }, // Should process normally
        { path: "large.ts" }, // Should exceed limit
      ];

      const output = await getReadContent(mockRequests, false);

      // Verify small file processes normally
      expect(output).toContain("small.ts (lines 1-1 (Full File))");
      expect(output).toContain("console.log('small');");

      // Verify medium file range processes normally
      expect(output).toContain("medium.ts (lines 1-50 of 100)");
      expect(output).toContain("console.log('medium');");

      // Verify large file exceeds limit
      expect(output).toContain("[EXCEEDS TOKEN LIMIT]");
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("large.ts exceeds token limit (2000 > 1000)"),
      );

      // Verify no compaction advisory since no compaction occurred
      expect(output).not.toContain("COMPACTION NOTICE");
    });
  });
});
