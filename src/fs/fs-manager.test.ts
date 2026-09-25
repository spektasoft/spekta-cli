import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type MockedFunction,
} from "vitest";
import {
  getNextReviewMetadata,
  getReviewDir,
  ensureIgnoredDir,
} from "./fs-manager.js";
import fs from "fs-extra";
import * as path from "path";

vi.mock("fs-extra");

describe("getNextReviewMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return nextNum 1 when directory is empty", async () => {
    (
      fs.readdir as unknown as MockedFunction<
        (dir: string) => Promise<string[]>
      >
    ).mockResolvedValue([]);
    const result = await getNextReviewMetadata("/mock/dir");
    expect(result.nextNum).toBe(1);
    expect(result.lastFile).toBeNull();
  });

  it("should correctly parse standard file patterns with valid hex", async () => {
    const files = ["r-001-abcdef..123456.md", "r-002-deadbe..efc0de.md"];
    (
      fs.readdir as unknown as MockedFunction<
        (dir: string) => Promise<string[]>
      >
    ).mockResolvedValue(files);

    const result = await getNextReviewMetadata("/mock/dir");
    expect(result.nextNum).toBe(3);
    expect(result.lastFile).toBe("r-002-deadbe..efc0de.md");
  });

  it("should ignore files that do not match the strict pattern", async () => {
    const files = [
      "r-001-abcdef..123456.md",
      "random-file.txt",
      "r-string-abcdef..123456.md",
      "r-002-ghi..jkl.md",
    ];
    (
      fs.readdir as unknown as MockedFunction<
        (dir: string) => Promise<string[]>
      >
    ).mockResolvedValue(files);

    const result = await getNextReviewMetadata("/mock/dir");
    expect(result.nextNum).toBe(2);
    expect(result.lastFile).toBe("r-001-abcdef..123456.md");
  });
});

describe("getReviewDir", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create directory asynchronously for initial review", async () => {
    vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
    (
      fs.pathExists as unknown as MockedFunction<
        (path: string) => Promise<boolean>
      >
    ).mockResolvedValue(false);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const result = await getReviewDir(true);

    expect(fs.ensureDir).toHaveBeenCalled();
    expect(result.id).toMatch(/^\d{12}$/);
    expect(result.dir).toContain(result.id);
  });

  it("should throw error if folderId is provided but directory does not exist", async () => {
    (
      fs.pathExists as unknown as MockedFunction<
        (path: string) => Promise<boolean>
      >
    ).mockResolvedValue(false);

    await expect(getReviewDir(false, "202301010101")).rejects.toThrow(
      "Review folder not found: 202301010101",
    );
  });
});

describe("ensureIgnoredDir", () => {
  const mockDir = "/test/path";
  const mockRoot = "/test/root";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates the input directory and initializes .gitignore if missing", async () => {
    vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await ensureIgnoredDir(mockDir, mockRoot);

    expect(fs.ensureDir).toHaveBeenCalledWith(mockDir);
    expect(fs.ensureDir).toHaveBeenCalledWith(mockRoot);
    const expectedIgnorePath = path.join(mockRoot, ".gitignore");
    expect(fs.writeFile).toHaveBeenCalledWith(expectedIgnorePath, "*\n", {
      flag: "wx",
    });
  });

  it("does not overwrite existing .gitignore", async () => {
    vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockRejectedValue(
      Object.assign(new Error("File exists"), { code: "EEXIST" }),
    );

    await expect(ensureIgnoredDir(mockDir, mockRoot)).resolves.not.toThrow();

    const expectedIgnorePath = path.join(mockRoot, ".gitignore");
    expect(fs.writeFile).toHaveBeenCalledWith(expectedIgnorePath, "*\n", {
      flag: "wx",
    });
  });

  it("rethrows non-EEXIST errors from writeFile", async () => {
    vi.mocked(fs.ensureDir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockRejectedValue(
      Object.assign(new Error("Permission denied"), { code: "EACCES" }),
    );

    await expect(ensureIgnoredDir(mockDir, mockRoot)).rejects.toThrow(
      "Permission denied",
    );
  });
});
