import { beforeEach, describe, expect, it, vi } from "vitest";
import * as config from "../core/config";
import * as compactor from "./compactor";
import * as readUtils from "./read-utils";
import * as security from "./security";
import { analyzeFile } from "./file-analyzer";

vi.mock("../core/config");
vi.mock("./compactor");
vi.mock("./read-utils");
vi.mock("./security");

describe("analyzeFile", () => {
  const mockGetReadTokenLimit = vi.mocked(config.getReadTokenLimit);
  const mockGetCompactThreshold = vi.mocked(config.getCompactThreshold);
  const mockGetFileLines = vi.mocked(readUtils.getFileLines);
  const mockGetTokenCount = vi.mocked(readUtils.getTokenCount);
  const mockValidatePathAccess = vi.mocked(security.validatePathAccess);
  const mockCompactFile = vi.mocked(compactor.compactFile);

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetReadTokenLimit.mockReturnValue(1000);
    mockGetCompactThreshold.mockReturnValue(500);
    mockValidatePathAccess.mockResolvedValue(undefined);
  });

  it("returns a healthy analysis for a small file below threshold and limit", async () => {
    mockGetFileLines.mockResolvedValue({ lines: ["small content"], total: 1 });
    mockGetTokenCount.mockReturnValue(50);

    const result = await analyzeFile("small.ts");

    expect(result).toEqual({
      path: "small.ts",
      content: "small content",
      totalLines: 1,
      rawTokens: 50,
      finalTokens: 50,
      isCompacted: false,
      compactionWarning: undefined,
      exceedsLimit: false,
      excessTokens: 0,
    });
    expect(mockCompactFile).not.toHaveBeenCalled();
  });

  it("compacts files above the compact threshold and measures final tokens from the compacted content", async () => {
    mockGetFileLines.mockResolvedValue({
      lines: ["A".repeat(2500)],
      total: 250,
    });
    mockCompactFile.mockReturnValue({
      content: "compacted content",
      isCompacted: true,
    });
    // First call: raw token measurement. Second call: final measurement on compacted content.
    mockGetTokenCount.mockReturnValueOnce(2500).mockReturnValueOnce(50);

    const result = await analyzeFile("large.ts");

    expect(mockCompactFile).toHaveBeenCalledWith(
      "large.ts",
      "A".repeat(2500),
      1,
    );
    expect(result.rawTokens).toBe(2500);
    expect(result.finalTokens).toBe(50);
    expect(result.isCompacted).toBe(true);
    expect(result.content).toBe("compacted content");
    expect(result.exceedsLimit).toBe(false);
  });

  it("is healthy when compaction brings a raw-over-limit file back under the limit", async () => {
    mockGetReadTokenLimit.mockReturnValue(1000);
    mockGetCompactThreshold.mockReturnValue(500);
    mockGetFileLines.mockResolvedValue({ lines: ["B".repeat(2500)], total: 1 });
    mockCompactFile.mockReturnValue({
      content: "compacted content",
      isCompacted: true,
    });
    mockGetTokenCount.mockReturnValueOnce(2500).mockReturnValueOnce(800);

    const result = await analyzeFile("was-large.ts");

    expect(result.rawTokens).toBe(2500);
    expect(result.finalTokens).toBe(800);
    expect(result.exceedsLimit).toBe(false);
    expect(result.excessTokens).toBe(0);
  });

  it("flags a violation for a file below the compact threshold whose token count exceeds the limit", async () => {
    mockGetReadTokenLimit.mockReturnValue(200);
    mockGetCompactThreshold.mockReturnValue(500);
    mockGetFileLines.mockResolvedValue({
      lines: ["moderate content"],
      total: 1,
    });
    mockGetTokenCount.mockReturnValue(300);

    const result = await analyzeFile("moderate.ts");

    expect(mockCompactFile).not.toHaveBeenCalled();
    expect(result.finalTokens).toBe(300);
    expect(result.exceedsLimit).toBe(true);
    expect(result.excessTokens).toBe(100);
  });

  it("preserves a compaction warning as metadata without treating it as an error", async () => {
    mockGetReadTokenLimit.mockReturnValue(1000);
    mockGetCompactThreshold.mockReturnValue(500);
    const content = "C".repeat(600);
    mockGetFileLines.mockResolvedValue({ lines: [content], total: 1 });
    mockCompactFile.mockReturnValue({
      content,
      isCompacted: false,
      warning:
        'Compaction skipped: "php" support is not yet verified for structural compaction.',
    });
    mockGetTokenCount.mockReturnValue(600);

    const result = await analyzeFile("legacy.php");

    expect(result.isCompacted).toBe(false);
    expect(result.compactionWarning).toBe(
      'Compaction skipped: "php" support is not yet verified for structural compaction.',
    );
    expect(result.exceedsLimit).toBe(false);
  });

  it("analyzes an empty file successfully", async () => {
    mockGetFileLines.mockResolvedValue({ lines: [], total: 0 });
    mockGetTokenCount.mockReturnValue(0);

    const result = await analyzeFile("empty.ts");

    expect(mockCompactFile).not.toHaveBeenCalled();
    expect(result.content).toBe("");
    expect(result.rawTokens).toBe(0);
    expect(result.finalTokens).toBe(0);
    expect(result.exceedsLimit).toBe(false);
    expect(result.excessTokens).toBe(0);
  });

  it("surfaces a security denial as a failure without reading the file", async () => {
    mockValidatePathAccess.mockRejectedValue(
      new Error("Access denied: path is outside the allowed workspace"),
    );

    await expect(analyzeFile("../outside-file.txt")).rejects.toThrow(
      "Access denied: path is outside the allowed workspace",
    );
    expect(mockGetFileLines).not.toHaveBeenCalled();
  });

  it("surfaces a required read failure as a failure", async () => {
    mockGetFileLines.mockRejectedValue(new Error("ENOENT: file not found"));

    await expect(analyzeFile("missing.ts")).rejects.toThrow(
      "ENOENT: file not found",
    );
  });
});
