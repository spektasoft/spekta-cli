import { execa } from "execa";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getGrepTokenLimit, getIgnorePatterns } from "../../core/config";
import { validateReadPathAccess } from "../../utils/security";
import { resolveWorkspace } from "../../utils/workspace";
import path from "node:path";
import { getGrepContent, MAX_MATCHES } from "../grep-search";
import { createRgMatch, mockExecaStream } from "./grep-search.test.helpers";

vi.mock("execa");
vi.mock("fs-extra");
vi.mock("../../utils/path-ignore", () => ({
  isPathIgnored: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../utils/security", () => ({
  validateReadPathAccess: vi.fn(),
  RESTRICTED_FILES: [".env", ".gitignore", ".spektaignore"],
}));
vi.mock("../../utils/workspace", () => ({ resolveWorkspace: vi.fn() }));
vi.mock("../../core/config", () => ({
  HOME_IGNORE: "/mock/home/.spektaignore",
  getAssetPaths: () => ({
    ASSET_DEFAULT_IGNORE: "/mock/assets/default.ignore",
  }),
  getGrepTokenLimit: vi.fn().mockReturnValue(2000),
  getIgnorePatterns: vi.fn().mockResolvedValue([]),
}));

describe("getGrepContent - truncation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getIgnorePatterns).mockResolvedValue([]);
    vi.mocked(resolveWorkspace).mockImplementation((context) => {
      const root = path.resolve(context?.root ?? process.cwd());
      return Promise.resolve({ root, canonicalRoot: root });
    });
    vi.mocked(validateReadPathAccess).mockImplementation((target, workspace) =>
      Promise.resolve(path.resolve(workspace.canonicalRoot, target)),
    );
    vi.mocked(fs.pathExists).mockResolvedValue(false as never);
    vi.mocked(getGrepTokenLimit).mockReturnValue(2000);
  });

  it("truncates results when match limit is reached", async () => {
    // Neutralize the token-limit guard so this test isolates MAX_MATCHES only
    vi.mocked(getGrepTokenLimit).mockReturnValue(1_000_000);

    const matches = Array.from({ length: MAX_MATCHES + 1 }, (_, i) =>
      createRgMatch("test.ts", i + 1, 0, `match ${i}`),
    ).join("\n");

    vi.mocked(execa).mockImplementation(() => mockExecaStream(matches));

    const result = await getGrepContent({ pattern: "test" });
    expect(result).toContain("Results truncated");
    const matchCount = (result.match(/match \d+/g) || []).length;
    expect(matchCount).toBe(MAX_MATCHES);
  });

  it("truncates results when the grep token limit is reached", async () => {
    vi.mocked(getGrepTokenLimit).mockReturnValue(5);

    const matches = Array.from({ length: 50 }, (_, i) =>
      createRgMatch(
        "huge.ts",
        i + 1,
        0,
        `some reasonably long matched line of source code ${i}`,
      ),
    ).join("\n");

    vi.mocked(execa).mockImplementation(() => mockExecaStream(matches));

    const result = await getGrepContent({ pattern: "some" });

    expect(result).toContain("Results truncated");
    const matchCount = (result.match(/some reasonably long/g) || []).length;
    expect(matchCount).toBeLessThan(50);
  });
});
