import { describe, expect, it, vi, beforeEach } from "vitest";
import { getGrepContent } from "./grep";
import { validatePathAccess } from "../utils/security";
import { execa } from "execa";
import fs from "fs-extra";

vi.mock("execa");
vi.mock("fs-extra");
vi.mock("../utils/security", () => ({
  validatePathAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../config", () => ({
  HOME_IGNORE: "/mock/home/.spektaignore",
  HOME_DEFAULT_IGNORE: "/mock/home/.spektadefaultignore",
  getIgnorePatterns: vi.fn().mockResolvedValue([]),
}));

describe("getGrepContent pattern validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default execa mock to resolve for rg --version and rg execution
    (execa as any).mockReturnValue(
      Object.assign(Promise.resolve({ exitCode: 0 }), {
        stdout: null,
        kill: vi.fn(),
      }),
    );
    (fs.pathExists as any).mockResolvedValue(false);
  });

  it("rejects empty string pattern", async () => {
    await expect(getGrepContent({ pattern: "" })).rejects.toThrow(
      "Pattern cannot be empty or whitespace-only.",
    );
  });

  it("rejects whitespace-only patterns", async () => {
    await expect(getGrepContent({ pattern: "   " })).rejects.toThrow(
      "Pattern cannot be empty or whitespace-only.",
    );
  });

  it("accepts valid pattern with non-whitespace content", async () => {
    // This should not throw the validation error and should now resolve correctly
    await expect(getGrepContent({ pattern: "valid" })).resolves.not.toThrow();
    expect(validatePathAccess).toHaveBeenCalledWith(".");
  });
});
