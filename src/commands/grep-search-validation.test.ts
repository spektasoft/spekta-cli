import { describe, expect, it, vi, beforeEach } from "vitest";
import { getGrepContent } from "./grep-search";
import { validateReadPathAccess } from "../utils/security";
import { resolveWorkspace } from "../utils/workspace";
import path from "node:path";
import { execa } from "execa";
import fs from "fs-extra";

vi.mock("execa");
vi.mock("fs-extra");
vi.mock("../utils/security", () => ({
  validateReadPathAccess: vi.fn(),
  RESTRICTED_FILES: [".env", ".gitignore", ".spektaignore"],
}));
vi.mock("../utils/workspace", () => ({ resolveWorkspace: vi.fn() }));

vi.mock("../core/config", () => ({
  HOME_IGNORE: "/mock/home/.spektaignore",
  getAssetPaths: () => ({
    ASSET_DEFAULT_IGNORE: "/mock/assets/default.ignore",
  }),
  getIgnorePatterns: vi.fn().mockResolvedValue([]),
  getGrepTokenLimit: vi.fn().mockReturnValue(2000),
}));

describe("getGrepContent pattern validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkspace).mockImplementation((context) => {
      const root = path.resolve(context?.root ?? process.cwd());
      return Promise.resolve({ root, canonicalRoot: root });
    });
    vi.mocked(validateReadPathAccess).mockImplementation((target, workspace) =>
      Promise.resolve(path.resolve(workspace.canonicalRoot, target)),
    );
    vi.mocked(execa).mockReturnValue(
      Object.assign(Promise.resolve({ exitCode: 0 }), {
        stdout: null,
        kill: vi.fn(),
      }) as never,
    );
    vi.mocked(fs.pathExists).mockResolvedValue(false as never);
  });

  it("rejects empty string pattern", async () => {
    await expect(getGrepContent({ pattern: "" })).resolves.toContain(
      "Search pattern cannot be empty or whitespace-only.",
    );
  });

  it("rejects whitespace-only patterns", async () => {
    await expect(getGrepContent({ pattern: "   " })).resolves.toContain(
      "Search pattern cannot be empty or whitespace-only.",
    );
    expect(execa).not.toHaveBeenCalled();
  });

  it("accepts valid pattern with non-whitespace content", async () => {
    await expect(getGrepContent({ pattern: "valid" })).resolves.not.toThrow();
    expect(validateReadPathAccess).toHaveBeenCalledWith(".", {
      root: process.cwd(),
      canonicalRoot: process.cwd(),
    });
  });
});
