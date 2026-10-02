import { execa } from "execa";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { getIgnorePatterns } from "../core/config";
import {
  isWhitelisted,
  validateEditAccess,
  validateGitTracked,
  validatePathAccess,
} from "./security";

vi.mock("fs-extra", () => ({
  default: {
    stat: vi.fn(),
    pathExists: vi.fn(),
    realpath: vi.fn(),
    ensureDir: vi.fn(),
    remove: vi.fn(),
  },
}));

const mockStat = fs.stat as unknown as Mock;
const mockPathExists = fs.pathExists as unknown as Mock;

type MockStatOptions = {
  size?: number;
  isFile?: () => boolean;
  isDirectory?: () => boolean;
};

const createMockStat = (opts: MockStatOptions = {}): fs.Stats =>
  ({
    size: opts.size ?? 0,
    isFile: opts.isFile ?? (() => false),
    isDirectory: opts.isDirectory ?? (() => false),
  }) as unknown as fs.Stats;

const createMockExecaResult = (
  stdout = "",
): Awaited<ReturnType<typeof execa>> =>
  ({ stdout }) as unknown as Awaited<ReturnType<typeof execa>>;

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("../core/config", () => ({
  getIgnorePatterns: vi.fn(),
}));

describe("isWhitelisted", () => {
  it("should return false when no patterns are provided", () => {
    expect(isWhitelisted("src/index.ts", [])).toBe(false);
  });

  it("should return false when no negation patterns are present", () => {
    expect(isWhitelisted("src/index.ts", ["node_modules/", "dist/"])).toBe(
      false,
    );
  });

  it("should return true for exact match in whitelist", () => {
    expect(
      isWhitelisted("src/ignored-but-allowed.ts", [
        "!src/ignored-but-allowed.ts",
      ]),
    ).toBe(true);
  });

  it("should return true for directory match in whitelist", () => {
    expect(
      isWhitelisted("src/allowed-dir/file.ts", ["!src/allowed-dir/"]),
    ).toBe(true);
  });

  it("should return false for paths not matching any whitelist pattern", () => {
    expect(isWhitelisted("src/still-ignored.ts", ["!src/allowed-dir/"])).toBe(
      false,
    );
  });

  it("should handle multiple whitelist patterns", () => {
    const patterns = ["!src/allowed-dir/", "!src/special.ts"];
    expect(isWhitelisted("src/allowed-dir/file.ts", patterns)).toBe(true);
    expect(isWhitelisted("src/special.ts", patterns)).toBe(true);
    expect(isWhitelisted("src/other.ts", patterns)).toBe(false);
  });
});

describe("Security Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStat.mockResolvedValue(
      createMockStat({
        size: 1024,
        isFile: () => true,
        isDirectory: () => false,
      }),
    );
    mockPathExists.mockResolvedValue(true);
    vi.mocked(getIgnorePatterns).mockResolvedValue([]);
    vi.mocked(execa).mockRejectedValue({ exitCode: 1 });
  });

  it("should block restricted files even with relative paths", async () => {
    await expect(validatePathAccess("./.env")).rejects.toThrow(
      "restricted system file",
    );
  });

  it("should allow access to valid files within project directory", async () => {
    await expect(
      validatePathAccess("./valid-file.txt"),
    ).resolves.toBeUndefined();

    await expect(
      validatePathAccess("src/valid-file.ts"),
    ).resolves.toBeUndefined();
  });

  it("should allow access to the project root '.'", async () => {
    mockStat.mockResolvedValue(
      createMockStat({
        size: 0,
        isFile: () => false,
        isDirectory: () => true,
      }),
    );
    await expect(validatePathAccess(".")).resolves.not.toThrow();
  });

  it("should allow directory paths", async () => {
    mockStat.mockResolvedValue(
      createMockStat({
        size: 0,
        isFile: () => false,
        isDirectory: () => true,
      }),
    );
    await expect(validatePathAccess("src")).resolves.not.toThrow();
  });

  it("should deny access to restricted files", async () => {
    await expect(validatePathAccess(".env")).rejects.toThrow(
      "Access Denied: .env is a restricted system file.",
    );
    await expect(validatePathAccess(".gitignore")).rejects.toThrow(
      "Access Denied: .gitignore is a restricted system file.",
    );
    await expect(validatePathAccess(".spektaignore")).rejects.toThrow(
      "Access Denied: .spektaignore is a restricted system file.",
    );
  });

  it("should deny access to files outside project directory", async () => {
    await expect(validatePathAccess("../outside-file.txt")).rejects.toThrow(
      "Access Denied: ../outside-file.txt is outside the project directory.",
    );
    await expect(validatePathAccess("/etc/passwd")).rejects.toThrow(
      "Access Denied: /etc/passwd is outside the project directory.",
    );
  });

  it("should deny access to files ignored by .spektaignore", async () => {
    vi.mocked(getIgnorePatterns).mockResolvedValue(["ignored-file.txt"]);

    await expect(validatePathAccess("ignored-file.txt")).rejects.toThrow(
      "Access Denied: ignored-file.txt is ignored by .spektaignore.",
    );
  });

  it("should deny access to files ignored by git", async () => {
    vi.mocked(execa).mockResolvedValue(createMockExecaResult("ignored.txt"));
    vi.mocked(getIgnorePatterns).mockResolvedValue([]);

    await expect(validatePathAccess("ignored.txt")).rejects.toThrow(
      "Access Denied: ignored.txt is ignored by git.",
    );
  });

  it("should allow access to git-ignored files if whitelisted in .spektaignore", async () => {
    vi.mocked(execa).mockResolvedValue(
      createMockExecaResult("git-ignored.txt"),
    );
    vi.mocked(getIgnorePatterns).mockResolvedValue(["!git-ignored.txt"]);
    mockStat.mockResolvedValue(
      createMockStat({
        size: 0,
        isFile: () => true,
        isDirectory: () => false,
      }),
    );

    await expect(validatePathAccess("git-ignored.txt")).resolves.not.toThrow();
  });

  it("rejects files larger than 10MB", async () => {
    mockStat.mockResolvedValue(
      createMockStat({
        size: 20 * 1024 * 1024,
        isFile: () => true,
        isDirectory: () => false,
      }),
    );

    await expect(validatePathAccess("big.log")).rejects.toThrow(
      "exceeds size limit",
    );
  });

  it("rejects non-existent paths with descriptive error", async () => {
    const error = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    mockStat.mockRejectedValue(error);

    await expect(validatePathAccess("missing.txt")).rejects.toThrow(
      "Access Denied: The path 'missing.txt' does not exist.",
    );
  });

  describe("validateGitTracked", () => {
    it("should pass for tracked files", async () => {
      vi.mocked(execa).mockResolvedValue(
        createMockExecaResult("tracked-file.ts"),
      );
      await expect(
        validateGitTracked("tracked-file.ts"),
      ).resolves.not.toThrow();
    });

    it("should reject untracked files", async () => {
      vi.mocked(execa).mockRejectedValue(new Error("not tracked"));
      await expect(validateGitTracked("untracked.ts")).rejects.toThrow(
        "Edit Denied: untracked.ts is not tracked by git.",
      );
    });
  });

  describe("validateEditAccess", () => {
    it("should pass access checks for an eligible file without requiring tracking", async () => {
      vi.mocked(execa).mockRejectedValueOnce({ exitCode: 1 }); // check-ignore
      await expect(validateEditAccess("valid-file.ts")).resolves.not.toThrow();
      expect(execa).toHaveBeenCalledWith("git", [
        "check-ignore",
        "-q",
        "--no-index",
        "valid-file.ts",
      ]);
    });

    it("should reject restricted files even if tracked", async () => {
      await expect(validateEditAccess(".gitignore")).rejects.toThrow(
        "restricted system file",
      );
    });
  });
});
