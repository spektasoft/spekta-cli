import { describe, it, expect, vi, beforeEach } from "vitest";
import { getNextReviewMetadata } from "./fs-manager.js";
import fs from "fs-extra";

vi.mock("fs-extra");

describe("getNextReviewMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return nextNum 1 when directory is empty", () => {
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    const result = getNextReviewMetadata("/mock/dir");
    expect(result.nextNum).toBe(1);
    expect(result.lastFile).toBeNull();
  });

  it("should correctly parse standard file patterns", () => {
    const files = ["r-001-hash1-hash2.md", "r-002-hash3-hash4.md"];
    vi.mocked(fs.readdirSync).mockReturnValue(files as any);

    const result = getNextReviewMetadata("/mock/dir");
    expect(result.nextNum).toBe(3);
    expect(result.lastFile).toBe("r-002-hash3-hash4.md");
  });

  it("should ignore files that do not match the pattern", () => {
    const files = [
      "r-001-hash1-hash2.md",
      "random-file.txt",
      "r-string-hash1-hash2.md",
    ];
    vi.mocked(fs.readdirSync).mockReturnValue(files as any);

    const result = getNextReviewMetadata("/mock/dir");
    expect(result.nextNum).toBe(2);
    expect(result.lastFile).toBe("r-001-hash1-hash2.md");
  });

  it("should handle multi-digit sequences and non-sequential files", () => {
    const files = [
      "r-005-hashA-hashB.md",
      "r-010-hashC-hashD.md",
      "r-002-hashE-hashF.md",
    ];
    vi.mocked(fs.readdirSync).mockReturnValue(files as any);

    const result = getNextReviewMetadata("/mock/dir");
    expect(result.nextNum).toBe(11);
    expect(result.lastFile).toBe("r-010-hashC-hashD.md");
  });

  it("should be robust against hashes containing 'r-' or numbers", () => {
    const files = ["r-001-12345-67890.md", "r-002-abc-r-99-def.md"];
    vi.mocked(fs.readdirSync).mockReturnValue(files as any);

    const result = getNextReviewMetadata("/mock/dir");
    expect(result.nextNum).toBe(3);
    expect(result.lastFile).toBe("r-002-abc-r-99-def.md");
  });
});
