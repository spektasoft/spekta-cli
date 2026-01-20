import { describe, it, expect, vi, beforeEach } from "vitest";
import { validatePathAccess } from "./security";

// Mock the dependencies
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("../config", () => ({
  getIgnorePatterns: vi.fn(),
}));

describe("Security Validation", () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  it("should block restricted files even with relative paths", async () => {
    await expect(validatePathAccess("./.env")).rejects.toThrow(
      "restricted system file",
    );
  });

  it("should allow access to valid files within project directory", async () => {
    const { execa } = await import("execa");
    vi.mocked(execa).mockRejectedValue({ exitCode: 1 }); // Not ignored by git

    const { getIgnorePatterns } = await import("../config");
    vi.mocked(getIgnorePatterns).mockResolvedValue([]);

    // This should not throw an error
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
    await expect(validatePathAccess("/etc/passwd")).rejects.toThrow(
      "Access Denied: /etc/passwd is outside the project directory.",
    );
  });

  it("should deny access to files ignored by .spektaignore", async () => {
    const { getIgnorePatterns } = await import("../config");
    vi.mocked(getIgnorePatterns).mockResolvedValue(["ignored-file.txt"]);

    await expect(validatePathAccess("ignored-file.txt")).rejects.toThrow(
      "Access Denied: ignored-file.txt is ignored by .spektaignore.",
    );
  });
});
