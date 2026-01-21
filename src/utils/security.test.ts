import { describe, it, expect, vi, beforeEach } from "vitest";
import { validatePathAccess } from "./security";
import fs from "fs-extra";
import { execa } from "execa";
import { getIgnorePatterns } from "../config";

// 1. Mock fs-extra with a default export structure
vi.mock("fs-extra", () => ({
  default: {
    stat: vi.fn(),
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
});
