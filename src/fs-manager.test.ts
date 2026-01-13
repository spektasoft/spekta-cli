import { describe, it, expect, vi, beforeEach } from "vitest";
import { getNextReviewMetadata, getReviewDir } from "./fs-manager.js";
import fs from "fs-extra";

vi.mock("fs-extra");

describe("getNextReviewMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return nextNum 1 when directory is empty", async () => {
    vi.mocked(fs.readdir).mockResolvedValue([] as any);
    const result = await getNextReviewMetadata("/mock/dir");
    expect(result.nextNum).toBe(1);
    expect(result.lastFile).toBeNull();
  });

  it("should correctly parse standard file patterns with valid hex", async () => {
    // Using valid hex characters (a-f, 0-9)
    const files = ["r-001-abcdef..123456.md", "r-002-deadbe..efc0de.md"];
    vi.mocked(fs.readdir).mockResolvedValue(files as any);

    const result = await getNextReviewMetadata("/mock/dir");
    expect(result.nextNum).toBe(3);
    expect(result.lastFile).toBe("r-002-deadbe..efc0de.md");
  });

  it("should ignore files that do not match the strict pattern", async () => {
    const files = [
      "r-001-abcdef..123456.md",
      "random-file.txt",
      "r-string-abcdef..123456.md",
      "r-002-ghi..jkl.md", // Invalid hex characters 'g-l'
    ];
    vi.mocked(fs.readdir).mockResolvedValue(files as any);

    const result = await getNextReviewMetadata("/mock/dir");
    expect(result.nextNum).toBe(2);
    expect(result.lastFile).toBe("r-001-abcdef..123456.md");
  });

  it("should handle multi-digit sequences and non-sequential files", async () => {
    const files = [
      "r-005-aaaaaa..bbbbbb.md",
      "r-010-cccccc..dddddd.md",
      "r-002-eeeeee..ffffff.md",
    ];
    vi.mocked(fs.readdir).mockResolvedValue(files as any);

    const result = await getNextReviewMetadata("/mock/dir");
    expect(result.nextNum).toBe(11);
    expect(result.lastFile).toBe("r-010-cccccc..dddddd.md");
  });

  it("should be robust against hashes containing numbers", async () => {
    const files = ["r-001-123456..789012.md", "r-002-a1b2c3..d4e5f6.md"];
    vi.mocked(fs.readdir).mockResolvedValue(files as any);

    const result = await getNextReviewMetadata("/mock/dir");
    expect(result.nextNum).toBe(3);
    expect(result.lastFile).toBe("r-002-a1b2c3..d4e5f6.md");
  });
});

describe("getReviewDir", () => {
  it("should create directory asynchronously for initial review", async () => {
    vi.mocked(fs.ensureDir).mockResolvedValue(undefined as any);

    const result = await getReviewDir(true);

    expect(fs.ensureDir).toHaveBeenCalled();
    expect(result.id).toMatch(/^\d{12}$/);
    expect(result.dir).toContain(result.id);
  });

  it("should throw error if folderId is provided but directory does not exist", async () => {
    vi.mocked(fs.pathExists).mockResolvedValue(false as any);

    await expect(getReviewDir(false, "202301010101")).rejects.toThrow(
      "Review folder not found: 202301010101"
    );
  });
});
