import { beforeEach, describe, expect, it, vi } from "vitest";
import * as config from "../config";
import * as editorUtils from "../editor-utils";
import * as compactor from "../utils/compactor";
import * as readUtils from "../utils/read-utils";
import * as security from "../utils/security";
import { Logger } from "../utils/logger";
import { runRead } from "./read";

vi.mock("../config");
vi.mock("../utils/read-utils");
vi.mock("../utils/security");
vi.mock("../utils/compactor");
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
    mockGetEnv.mockResolvedValue({ SPEKTA_READ_TOKEN_LIMIT: "2000" });
    mockValidatePathAccess.mockResolvedValue(undefined);
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
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
      expect.stringContaining("exceeds token limit (3000 > 2000)"),
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Error: Requested range for large.ts exceeds token limit (3000 > 2000)",
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
      expect.stringContaining("#### small.ts (lines 1-2 of 2)"),
    );
  });
});
