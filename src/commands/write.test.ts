import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import { getWriteContent, runWrite } from "./write";
import * as security from "../utils/security";
import * as formatUtils from "../utils/format-utils";
import { Logger } from "../utils/logger";
import { Readable } from "stream";

vi.mock("fs-extra");
vi.mock("../utils/security");
vi.mock("../utils/format-utils");
vi.mock("../utils/logger");

describe("write command logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(formatUtils.formatFile).mockImplementation(
      async (_, content) => content,
    );
    process.exitCode = 0;
  });

  it("should deny write to gitignored paths with appropriate message", async () => {
    const filePath = "node_modules/test.txt";
    const errorMsg =
      "Access Denied: node_modules/test.txt would be ignored by git.";

    vi.mocked(security.validatePathAccessForWrite).mockRejectedValue(
      new Error(errorMsg),
    );

    await expect(getWriteContent(filePath, "data")).rejects.toThrow(errorMsg);
  });

  it("should fail if the file already exists (after security passes)", async () => {
    const filePath = "existing.ts";
    vi.mocked(security.validatePathAccessForWrite).mockResolvedValue(undefined);
    vi.mocked(security.validateParentDirForCreate).mockResolvedValue(undefined);
    vi.mocked(fs.pathExists).mockResolvedValue(true as never);

    const result = await getWriteContent(filePath, "new content");

    expect(result.success).toBe(false);
    expect(result.message).toContain("File already exists");
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("should successfully write file when provided content via stdin", async () => {
    const filePath = "new-file.ts";
    const content = "console.log('hello');";

    // Mock stdin
    const stdinMock = Readable.from([content]);
    vi.stubGlobal("process", { ...process, stdin: stdinMock });

    vi.mocked(security.validatePathAccessForWrite).mockResolvedValue(undefined);
    vi.mocked(security.validateParentDirForCreate).mockResolvedValue(undefined);
    vi.mocked(fs.pathExists).mockResolvedValue(false as never);

    await runWrite([filePath]);

    expect(fs.ensureDir).toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      content,
      "utf-8",
    );
    expect(Logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Successfully created"),
    );

    vi.unstubAllGlobals();
  });
});
