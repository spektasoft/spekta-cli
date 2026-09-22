import { execa } from "execa";
import fs from "fs-extra";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getGrepTokenLimit } from "../../core/config";
import { validatePathAccess } from "../../utils/security";
import { getGrepContent } from "../grep-search";
import { mockExecaStream } from "./grep-search.test.helpers";

vi.mock("execa");
vi.mock("fs-extra");
vi.mock("../../utils/path-ignore", () => ({
  isPathIgnored: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../utils/security", () => ({
  validatePathAccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../core/config", () => ({
  HOME_IGNORE: "/mock/home/.spektaignore",
  getAssetPaths: () => ({
    ASSET_DEFAULT_IGNORE: "/mock/assets/default.ignore",
  }),
  getGrepTokenLimit: vi.fn().mockReturnValue(2000),
}));

describe("getGrepContent - flags", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(validatePathAccess).mockResolvedValue(undefined);
    vi.mocked(fs.pathExists).mockResolvedValue(false as never);
    vi.mocked(getGrepTokenLimit).mockReturnValue(2000);
  });

  it("verifies path access before execution", async () => {
    vi.mocked(execa).mockImplementation(() => mockExecaStream(""));
    await getGrepContent({ pattern: "test", path: "src" });
    expect(validatePathAccess).toHaveBeenCalledWith("src");
  });

  it("correctly applies glob and case sensitivity flags", async () => {
    vi.mocked(execa).mockImplementation(() => mockExecaStream(""));

    await getGrepContent({
      pattern: "test",
      globs: "*.ts",
      case_insensitive: false,
    });

    const lastCallArgs = vi.mocked(execa).mock.calls[1][1];
    expect(lastCallArgs).toContain("--json");
    expect(lastCallArgs).toContain("-g");
    expect(lastCallArgs).toContain("*.ts");
    expect(lastCallArgs).toContain("--case-sensitive");
    expect(lastCallArgs).not.toContain("--ignore-case");

    await getGrepContent({
      pattern: "test",
      case_insensitive: true,
    });
    const lastCallArgs2 = vi.mocked(execa).mock.calls[3][1];
    expect(lastCallArgs2).toContain("--ignore-case");
  });

  it("includes ignore-file flags when ignore files exist", async () => {
    vi.mocked(execa).mockImplementation(() => mockExecaStream(""));

    vi.mocked(fs.pathExists).mockImplementation((p: string) => {
      return Promise.resolve(
        p.includes(".spektaignore") || p.includes("default.ignore"),
      );
    });

    await getGrepContent({ pattern: "test" });

    const searchCallArgs = vi.mocked(execa).mock.calls[1]?.[1];
    if (!Array.isArray(searchCallArgs)) {
      throw new Error("Expected ripgrep search arguments");
    }

    const argsList = searchCallArgs as string[];
    expect(argsList).toContain("--ignore-file");
    expect(argsList).toContain("/mock/home/.spektaignore");
    expect(argsList).toContain("/mock/assets/default.ignore");

    const ignoreFileTarget =
      argsList[argsList.indexOf("--ignore-file") + 1] ?? "";
    const workspacePath = /.*\.spektaignore/.test(ignoreFileTarget);
    expect(workspacePath).toBeDefined();
  });
});
