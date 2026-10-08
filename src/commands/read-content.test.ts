import { beforeEach, describe, expect, it, vi } from "vitest";
import * as config from "../core/config";
import * as compactor from "../utils/compactor";
import * as readUtils from "../utils/read-utils";
import * as security from "../utils/security";
import * as fileAnalyzer from "../utils/file-analyzer";
import { Logger } from "../utils/logger";
import { getReadContent } from "./read";

vi.mock("../core/config", () => ({
  getReadTokenLimit: vi.fn().mockReturnValue(1000),
  getCompactThreshold: vi.fn().mockReturnValue(2000),
  getEnv: vi.fn().mockResolvedValue({ SPEKTA_READ_TOKEN_LIMIT: "1000" }),
}));
vi.mock("../utils/read-utils");
vi.mock("../utils/security");
vi.mock("../utils/file-analyzer", () => ({
  analyzeFile: vi.fn(),
}));
vi.mock("../utils/compactor", () => ({
  compactFile: vi.fn().mockReturnValue({
    content: "mocked compacted content",
    isCompacted: false,
  }),
}));
vi.mock("../utils/logger", () => ({
  Logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("getReadContent non-interactive mode behavior preservation", () => {
  const mockGetReadTokenLimit = vi.mocked(config.getReadTokenLimit);
  const mockGetCompactThreshold = vi.mocked(config.getCompactThreshold);
  const mockGetEnv = vi.mocked(config.getEnv);
  const mockGetFileLines = vi.mocked(readUtils.getFileLines);
  const mockGetTokenCount = vi.mocked(readUtils.getTokenCount);
  const mockValidatePathAccess = vi.mocked(security.validateReadPathAccess);
  const mockCompactFile = vi.mocked(compactor.compactFile);
  const mockAnalyzeFile = vi.mocked(fileAnalyzer.analyzeFile);
  const mockLogger = vi.mocked(Logger);

  beforeEach(() => {
    vi.resetAllMocks();
    mockGetReadTokenLimit.mockReturnValue(1000);
    mockGetCompactThreshold.mockReturnValue(2000);
    mockGetEnv.mockResolvedValue({ SPEKTA_READ_TOKEN_LIMIT: "1000" });
    mockValidatePathAccess.mockImplementation((target) =>
      Promise.resolve(target),
    );
    mockCompactFile.mockReturnValue({
      content: "mocked compacted content",
      isCompacted: false,
    });
    mockGetTokenCount.mockReturnValue(1);
  });

  describe("compaction warning logging", () => {
    it("should log compaction warning when present in non-interactive mode", async () => {
      mockAnalyzeFile.mockResolvedValue({
        path: "main.rs",
        content: "uncompacted content",
        totalLines: 1000,
        rawTokens: 2500,
        finalTokens: 2500,
        isCompacted: false,
        compactionWarning: "Example warning",
        exceedsLimit: true,
        excessTokens: 1500,
      });

      const output = await getReadContent([{ path: "main.rs" }], false);

      expect(output).toContain("[Example warning]");
    });

    it("does not log a compaction warning when no compaction warning is present", async () => {
      mockAnalyzeFile.mockResolvedValue({
        path: "main.rs",
        content: "compacted content",
        totalLines: 1000,
        rawTokens: 2500,
        finalTokens: 100,
        isCompacted: true,
        exceedsLimit: false,
        excessTokens: 0,
      });

      await getReadContent([{ path: "main.rs" }], false);

      expect(mockLogger.warn).not.toHaveBeenCalledWith("Example warning");
    });
  });

  it("non-interactive mode blocks range requests exceeding token limit", async () => {
    mockGetFileLines
      .mockResolvedValueOnce({
        lines: ["console.log('hello');"],
        total: 1,
      })
      .mockResolvedValueOnce({
        lines: ["console.log('hello');"],
        total: 1,
      })
      .mockResolvedValueOnce({
        lines: Array<string>(1000).fill("console.log('line');"),
        total: 1000,
      });

    mockGetTokenCount
      .mockReturnValueOnce(50)
      .mockReturnValueOnce(50)
      .mockReturnValueOnce(1500);

    const mockRequests = [
      { path: "small.ts", range: { start: 1, end: 10 } },
      { path: "large.ts", range: { start: 1, end: 1000 } },
    ];

    const output = await getReadContent(mockRequests, false);

    expect(output).toContain("Requested read exceeds the response budget");
  });

  it("non-interactive mode warns for full files exceeding limit without compaction", async () => {
    mockAnalyzeFile.mockResolvedValue({
      path: "uncompactable-large.ts",
      content: "large file content",
      totalLines: 200,
      rawTokens: 2500,
      finalTokens: 2000,
      isCompacted: false,
      exceedsLimit: true,
      excessTokens: 1000,
    });

    const mockRequests = [{ path: "uncompactable-large.ts" }];
    const output = await getReadContent(mockRequests, false);

    expect(output).toContain("[EXCEEDS TOKEN LIMIT]");
  });

  it("end-to-end non-interactive read command preserves original behavior", async () => {
    mockAnalyzeFile
      .mockResolvedValueOnce({
        path: "small.ts",
        content: "console.log('small');",
        totalLines: 1,
        rawTokens: 10,
        finalTokens: 10,
        isCompacted: false,
        exceedsLimit: false,
        excessTokens: 0,
      })
      .mockResolvedValueOnce({
        path: "large.ts",
        content: "large file content",
        totalLines: 1000,
        rawTokens: 2500,
        finalTokens: 2000,
        isCompacted: false,
        exceedsLimit: true,
        excessTokens: 1000,
      });
    mockGetFileLines
      .mockResolvedValueOnce({
        lines: Array<string>(100).fill("console.log('medium');"),
        total: 100,
      })
      .mockResolvedValueOnce({
        lines: Array<string>(100).fill("console.log('medium');"),
        total: 100,
      });

    mockGetTokenCount
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(500)
      .mockReturnValueOnce(1000);

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

    expect(output).not.toContain("COMPACTION NOTICE");
  });
});
