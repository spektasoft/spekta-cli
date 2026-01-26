import { execa } from "execa";
import fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getIgnorePatterns } from "../config";
import {
  findExistingAncestor,
  validateEditAccess,
  validateGitTracked,
  validateParentDirForCreate,
  validatePathAccess,
  validatePathAccessForWrite,
} from "./security";

// 1. Mock fs-extra with a default export structure
vi.mock("fs-extra", () => ({
  default: {
    stat: vi.fn(),
    pathExists: vi.fn(),
    ensureDir: vi.fn(),
    remove: vi.fn(),
  },
}));

// 2. Mock execa (named export)
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

// 3. Mock config (named export)
vi.mock("../config", () => ({
  getIgnorePatterns: vi.fn(),
}));

describe("Security Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default happy path setups
    vi.mocked(fs.stat).mockResolvedValue({ size: 1024 } as any);
    // @ts-ignore
    vi.mocked(fs.pathExists).mockResolvedValue(true); // Default: directories exist
    vi.mocked(getIgnorePatterns).mockResolvedValue([]);
    // Default execa behavior: Reject with exitCode 1 (meaning "git check-ignore" found nothing, so file is NOT ignored)
    // This allows the "valid file" checks to pass by default unless overridden
    vi.mocked(execa).mockRejectedValue({ exitCode: 1 });
  });

  it("should block restricted files even with relative paths", async () => {
    await expect(validatePathAccess("./.env")).rejects.toThrow(
      "restricted system file",
    );
  });

  it("should allow access to valid files within project directory", async () => {
    // execa is already mocked to reject with exitCode 1 in beforeEach (file not ignored by git)
    // getIgnorePatterns is already mocked to return [] in beforeEach

    await expect(
      validatePathAccess("./valid-file.txt"),
    ).resolves.toBeUndefined();

    await expect(
      validatePathAccess("src/valid-file.ts"),
    ).resolves.toBeUndefined();
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
    // Note: This relies on path.resolve(), so behavior depends on where the test runner is executed.
    // Assuming process.cwd() is the project root.
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
    // When git check-ignore succeeds (exitCode 0), it means the file IS ignored
    vi.mocked(execa).mockResolvedValue({ stdout: "ignored.txt" } as any);

    await expect(validatePathAccess("ignored.txt")).rejects.toThrow(
      "Access Denied: ignored.txt is ignored by git.",
    );
  });

  it("rejects files larger than 10MB", async () => {
    vi.mocked(fs.stat).mockResolvedValue({ size: 20 * 1024 * 1024 } as any);

    await expect(validatePathAccess("big.log")).rejects.toThrow(
      "exceeds size limit",
    );
  });

  describe("validateGitTracked", () => {
    it("should pass for tracked files", async () => {
      vi.mocked(execa).mockResolvedValue({ stdout: "tracked-file.ts" } as any);
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
    it("should pass all checks for valid tracked file", async () => {
      // 1. validatePathAccess:
      //    - fs.stat (already mocked to 1024)
      //    - getIgnorePatterns (already mocked to [])
      //    - execa (check-ignore) -> should reject (not ignored)
      // 2. validateGitTracked:
      //    - execa (ls-files) -> should resolve (tracked)

      vi.mocked(execa)
        .mockRejectedValueOnce({ exitCode: 1 } as any) // check-ignore
        .mockResolvedValueOnce({ stdout: "valid-file.ts" } as any); // ls-files

      await expect(validateEditAccess("valid-file.ts")).resolves.not.toThrow();
    });

    it("should reject restricted files even if tracked", async () => {
      await expect(validateEditAccess(".gitignore")).rejects.toThrow(
        "restricted system file",
      );
    });
  });
});

describe("validatePathAccessForWrite and validateParentDirForCreate", () => {
  describe("validatePathAccessForWrite", () => {
    it("should deny write to path outside project root", async () => {
      await expect(
        validatePathAccessForWrite("../outside-file.txt"),
      ).rejects.toThrow(
        "Access Denied: ../outside-file.txt is outside the project directory.",
      );

      await expect(validatePathAccessForWrite("/etc/passwd")).rejects.toThrow(
        "Access Denied: /etc/passwd is outside the project directory.",
      );
    });

    it("should deny write to gitignored path via git check-ignore", async () => {
      // Mock git check-ignore to succeed (exitCode 0), meaning file WOULD BE ignored
      vi.mocked(execa).mockResolvedValue({
        stdout: "ignored-new-file.txt",
      } as any);

      await expect(
        validatePathAccessForWrite("ignored-new-file.txt"),
      ).rejects.toThrow(
        "Access Denied: ignored-new-file.txt would be ignored by git.",
      );
    });
  });
});

describe("validateParentDirForCreate", () => {
  it("should permit write to new file in git repository", async () => {
    // Mock parent directory exists
    // @ts-ignore
    vi.mocked(fs.pathExists).mockResolvedValue(true);

    // Mock git rev-parse to succeed (we are inside a git repository)
    vi.mocked(execa).mockResolvedValue({ stdout: "true" } as any);

    await expect(
      validateParentDirForCreate("src/new-feature.ts"),
    ).resolves.not.toThrow();
  });

  it("should deny write to new file outside git repository", async () => {
    // Mock parent directory exists
    // @ts-ignore
    vi.mocked(fs.pathExists).mockResolvedValue(true);

    // Mock git rev-parse to fail (not inside a git repository)
    vi.mocked(execa).mockRejectedValue(new Error());

    await expect(
      validateParentDirForCreate("src/new-feature.ts"),
    ).rejects.toThrow("Parent directory is not in a git repository");
  });
});

describe("validateParentDirForCreate (new tests)", () => {
  const testDir = path.join(process.cwd(), "test-temp-validate");

  beforeEach(async () => {
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it("should allow creation in nested non-existent directories", async () => {
    const targetFile = path.join(testDir, "new", "nested", "file.ts");

    // Should not throw
    await expect(validateParentDirForCreate(targetFile)).resolves.not.toThrow();
  });

  it("should reject paths outside project root", async () => {
    const outsidePath = path.join(process.cwd(), "..", "outside", "file.ts");

    await expect(validateParentDirForCreate(outsidePath)).rejects.toThrow(
      "outside project root",
    );
  });
});

describe("findExistingAncestor", () => {
  const testDir = path.join(process.cwd(), "test-temp-ancestor");
  const existingPath = path.join(testDir, "existing");

  beforeEach(async () => {
    // Mock ensureDir to do nothing
    vi.mocked(fs.ensureDir).mockImplementation(() => Promise.resolve());

    // Mock remove to do nothing
    vi.mocked(fs.remove).mockImplementation(() => Promise.resolve());
  });

  it("should find existing parent when nested path does not exist", async () => {
    // Setup: non-existent path -> testDir/existing exists -> testDir exists -> root
    vi.mocked(fs.pathExists)
      // @ts-ignore
      .mockResolvedValueOnce(false) // testDir/existing/new/nested
      // @ts-ignore
      .mockResolvedValueOnce(true) // testDir/existing
      // @ts-ignore
      .mockResolvedValueOnce(true) // testDir
      // @ts-ignore
      .mockResolvedValueOnce(true); // root (/)

    vi.mocked(fs.stat)
      .mockResolvedValueOnce({ isDirectory: () => true } as any) // testDir/existing
      .mockResolvedValueOnce({ isDirectory: () => true } as any); // testDir

    const targetPath = path.join(testDir, "existing", "nested", "file.ts");
    const ancestor = await findExistingAncestor(path.dirname(targetPath));

    expect(ancestor).toBe(path.join(testDir, "existing"));
    expect(fs.stat).toHaveBeenCalledTimes(1);
  });

  it("should return the directory itself if it exists", async () => {
    // Setup: existingPath exists -> testDir exists -> root
    vi.mocked(fs.pathExists)
      // @ts-ignore
      .mockResolvedValueOnce(true) // existingPath
      // @ts-ignore
      .mockResolvedValueOnce(true) // testDir
      // @ts-ignore
      .mockResolvedValueOnce(true); // root (/)

    vi.mocked(fs.stat).mockResolvedValueOnce({
      isDirectory: () => true,
    } as any); // existingPath

    const ancestor = await findExistingAncestor(existingPath);

    expect(ancestor).toBe(existingPath);
  });
});
