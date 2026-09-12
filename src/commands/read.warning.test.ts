import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as config from "../core/config";
import * as compactor from "../utils/compactor";
import * as readUtils from "../utils/read-utils";
import * as security from "../utils/security";
import { Logger } from "../utils/logger";
import { getReadContent } from "./read";

vi.mock("../core/config");
vi.mock("../utils/read-utils");
vi.mock("../utils/security");
vi.mock("../utils/compactor");
vi.mock("../utils/logger", () => ({
  Logger: { warn: vi.fn(), error: vi.fn() },
}));

describe("compaction warning surfacing", () => {
  beforeEach(() => {
    vi.mocked(config.getReadTokenLimit).mockReturnValue(100000);
    vi.mocked(config.getCompactThreshold).mockReturnValue(10);
    vi.mocked(security.validatePathAccess).mockResolvedValue(undefined);
    vi.mocked(readUtils.getFileLines).mockResolvedValue({
      lines: Array.from({ length: 200 }, (_, i) => `line ${i}`),
      total: 200,
    });
    vi.mocked(readUtils.getTokenCount).mockReturnValue(500);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("logs and labels a compaction warning without marking the file as compacted", async () => {
    vi.mocked(compactor.compactFile).mockReturnValue({
      content: "unchanged content",
      isCompacted: false,
      warning:
        'Compaction skipped: "rust" support is not yet verified for structural compaction.',
    });

    const output = await getReadContent([{ path: "main.rs" }], false);

    expect(Logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("not yet verified"),
    );
    expect(output).toContain("Compaction skipped");
  });
});
