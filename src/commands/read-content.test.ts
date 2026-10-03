import { beforeEach, describe, expect, it, vi } from "vitest";
import * as config from "../core/config";
import * as compactor from "../utils/compactor";
import * as readUtils from "../utils/read-utils";
import * as security from "../utils/security";
import { Logger } from "../utils/logger";
import { getReadContent } from "./read";

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
  });

  describe("compaction warning logging", () => {
    it("should log compaction warning when present in non-interactive mode", async () => {
      const longContent = "line\n".repeat(1000);
      mockGetFileLines.mockResolvedValue({
        lines: longContent.trim().split("\n"),
        total: 1000,
      });
      mockGetTokenCount.mockReturnValue(2500);
      mockCompactFile.mockReturnValue({
        content: "uncompacted content",
        isCompacted: false,
        warning: "Example warning",
      });

      await getReadContent([{ path: "main.rs" }], false);

      expect(mockLogger.warn).toHaveBeenCalledWith("Example warning");
    });

    it("does not log a compaction warning when no compaction warning is present", async () => {
      const longContent = "line\n".repeat(1000);
      mockGetFileLines.mockResolvedValue({
        lines: longContent.trim().split("\n"),
        total: 1000,
      });
      mockGetTokenCount.mockReturnValue(2500);
      mockCompactFile.mockReturnValue({
        content: "compacted content",
        isCompacted: true,
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
      lines: Array<string>(200).fill(
        "console.log('line with long text that exceeds typical compaction threshold');",
      ),
      total: 200,
    });
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
        lines: Array<string>(100).fill("console.log('medium');"),
        total: 100,
      })
      .mockResolvedValueOnce({
        lines: Array<string>(100).fill("console.log('medium');"),
        total: 100,
      })
      .mockResolvedValueOnce({
        lines: Array<string>(1000).fill("console.log('large');"),
        total: 1000,
      });

    mockGetTokenCount
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(500)
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(2500)
      .mockReturnValueOnce(2000);

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
