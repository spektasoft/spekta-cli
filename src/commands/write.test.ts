import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import { getWriteContent, runWrite } from "./write";
import * as security from "../utils/security";
import * as formatUtils from "../utils/format-utils";
import { Logger } from "../utils/logger";
import { Readable } from "stream";
import path from "node:path";

vi.mock("fs-extra");
vi.mock("../utils/security");
vi.mock("../utils/format-utils");
vi.mock("../utils/logger");
vi.mock("../utils/workspace", () => ({
  resolveWorkspace: (context: { root: string } | undefined) =>
    Promise.resolve({
      root: context?.root ?? process.cwd(),
      canonicalRoot: context?.root ?? process.cwd(),
    }),
}));

describe("write command logic", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(formatUtils.formatFileInPlace).mockImplementation(async () => {});
    vi.mocked(security.validatePathAccessForWrite).mockImplementation(
      (target) => Promise.resolve(path.resolve(target)),
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

  it("reports an exclusive-create collision without formatting the target", async () => {
    const filePath = "existing.ts";
    vi.mocked(security.validatePathAccessForWrite).mockImplementation(
      (target) => Promise.resolve(path.resolve(target)),
    );
    vi.mocked(security.validateParentDirForCreate).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockRejectedValue(
      Object.assign(new Error("File exists"), { code: "EEXIST" }),
    );

    const result = await getWriteContent(filePath, "new content");

    expect(result.success).toBe(false);
    expect(result.message).toContain("File already exists");
    expect(formatUtils.formatFileInPlace).not.toHaveBeenCalled();
  });

  it("should successfully write file when provided content via stdin", async () => {
    const filePath = "new-file.ts";
    const content = "console.log('hello');";

    // Mock stdin
    const stdinMock = Readable.from([content]);
    Object.assign(stdinMock, { isTTY: false });
    vi.stubGlobal("process", { ...process, stdin: stdinMock });

    vi.mocked(security.validatePathAccessForWrite).mockImplementation(
      (target) => Promise.resolve(path.resolve(target)),
    );
    vi.mocked(security.validateParentDirForCreate).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await runWrite([filePath]);

    expect(fs.ensureDir).toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledWith(expect.any(String), content, {
      encoding: "utf-8",
      flag: "wx",
    });
    expect(Logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Successfully created"),
    );

    vi.unstubAllGlobals();
  });

  it("should successfully write file when provided content via argument", async () => {
    const filePath = "new-file.ts";
    const content = "console.log('from argument');";

    vi.mocked(security.validatePathAccessForWrite).mockImplementation(
      (target) => Promise.resolve(path.resolve(target)),
    );
    vi.mocked(security.validateParentDirForCreate).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await runWrite([filePath, content]);

    expect(fs.ensureDir).toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalledWith(expect.any(String), content, {
      encoding: "utf-8",
      flag: "wx",
    });
    expect(Logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Successfully created"),
    );
  });

  it("rethrows persistence errors other than EEXIST", async () => {
    vi.mocked(security.validatePathAccessForWrite).mockImplementation(
      (target) => Promise.resolve(path.resolve(target)),
    );
    vi.mocked(security.validateParentDirForCreate).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockRejectedValue(
      Object.assign(new Error("Permission denied"), { code: "EACCES" }),
    );

    await expect(getWriteContent("new-file.ts", "content")).rejects.toThrow(
      "Permission denied",
    );
    expect(formatUtils.formatFileInPlace).not.toHaveBeenCalled();
  });

  it("sets a nonzero exit code when exclusive creation finds an existing target", async () => {
    vi.mocked(security.validatePathAccessForWrite).mockImplementation(
      (target) => Promise.resolve(path.resolve(target)),
    );
    vi.mocked(security.validateParentDirForCreate).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockRejectedValue(
      Object.assign(new Error("File exists"), { code: "EEXIST" }),
    );

    await runWrite(["existing.ts", "new content"]);

    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining("File already exists"),
    );
    expect(Logger.info).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("uses the validated canonical destination for creation and formatting", async () => {
    const destination = path.resolve("canonical/new-file.ts");
    vi.mocked(security.validatePathAccessForWrite).mockResolvedValue(
      destination,
    );
    const workspace = { root: path.resolve("workspace-alias") };

    await getWriteContent("new-file.ts", "content", workspace);

    expect(security.validatePathAccessForWrite).toHaveBeenCalledWith(
      "new-file.ts",
      { root: workspace.root, canonicalRoot: workspace.root },
    );
    expect(fs.ensureDir).toHaveBeenCalledWith(path.dirname(destination));
    expect(fs.writeFile).toHaveBeenCalledWith(destination, "content", {
      encoding: "utf-8",
      flag: "wx",
    });
    expect(formatUtils.formatFileInPlace).toHaveBeenCalledWith(destination);
  });
});
