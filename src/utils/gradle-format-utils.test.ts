import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from "vitest";

import os from "os";
import fs from "fs-extra";
import { execa } from "execa";

import {
  formatKotlinFileInPlace,
  clearGradleTaskCache,
} from "./gradle-format-utils";

vi.mock("os", () => ({
  default: {
    platform: vi.fn(),
  },
}));

vi.mock("fs-extra", () => ({
  default: {
    pathExists: vi.fn(),
  },
}));

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

describe("formatKotlinFileInPlace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (clearGradleTaskCache as () => void)();
    vi.mocked(os.platform).mockReturnValue("linux");
    vi.mocked(execa).mockResolvedValue({
      exitCode: 0,
      stdout: "spotlessApply - Applies Spotless formatting",
    } as never);
    (
      fs.pathExists as unknown as MockedFunction<
        (path: string) => Promise<boolean>
      >
    ).mockImplementation((targetPath) => {
      const normalized = targetPath.replace(/\\/g, "/");
      return Promise.resolve(!normalized.includes("/src/"));
    });
  });

  it("uses gradlew through bash on Linux", async () => {
    await formatKotlinFileInPlace("/project/src/Main.kt");

    expect(execa).toHaveBeenCalledWith(
      "bash",
      ["/project/gradlew", "spotlessApply"],
      expect.objectContaining({
        cwd: "/project",
        reject: false,
      }),
    );
  });

  it("uses gradlew through bash on macOS", async () => {
    vi.mocked(os.platform).mockReturnValue("darwin");

    await formatKotlinFileInPlace("/project/src/Main.kt");

    expect(execa).toHaveBeenCalledWith(
      "bash",
      ["/project/gradlew", "spotlessApply"],
      expect.objectContaining({
        cwd: "/project",
        reject: false,
      }),
    );
  });

  it("uses gradlew.bat directly on Windows", async () => {
    vi.mocked(os.platform).mockReturnValue("win32");

    await formatKotlinFileInPlace("C:\\project\\src\\Main.kt");

    expect(execa).toHaveBeenCalledWith(
      expect.stringContaining("gradlew.bat"),
      ["spotlessApply"],
      expect.objectContaining({
        reject: false,
      }),
    );
  });

  it("prefers spotlessApply over ktlintFormat", async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          "spotlessApply - Applies Spotless formatting\nktlintFormat - Formats Kotlin",
      } as never)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "",
      } as never);

    await formatKotlinFileInPlace("/project/src/Main.kt");

    expect(vi.mocked(execa).mock.calls[1]?.[1]).toEqual([
      "/project/gradlew",
      "spotlessApply",
    ]);
  });

  it("uses ktlintFormat when spotlessApply is unavailable", async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "ktlintFormat - Formats Kotlin",
      } as never)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "",
      } as never);

    await formatKotlinFileInPlace("/project/src/Main.kt");

    expect(vi.mocked(execa).mock.calls[1]?.[1]).toEqual([
      "/project/gradlew",
      "ktlintFormat",
    ]);
  });

  it("uses formatKotlin when kotlinter plugin is configured", async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "formatKotlin - Formats Kotlin code",
      } as never)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "",
      } as never);

    await formatKotlinFileInPlace("/project/src/Main.kt");

    expect(vi.mocked(execa).mock.calls[1]?.[1]).toEqual([
      "/project/gradlew",
      "formatKotlin",
    ]);
  });

  it("detects tasks in multi-project builds with subproject prefixes", async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: ":app:spotlessApply - Applies Spotless formatting",
      } as never)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "",
      } as never);

    await formatKotlinFileInPlace("/project/src/Main.kt");

    expect(vi.mocked(execa).mock.calls[1]?.[1]).toEqual([
      "/project/gradlew",
      "spotlessApply",
    ]);
  });

  it("caches task resolution per project root", async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "spotlessApply - Applies Spotless formatting",
      } as never)
      .mockResolvedValue({
        exitCode: 0,
        stdout: "",
      } as never);

    await formatKotlinFileInPlace("/project/src/Main.kt");
    await formatKotlinFileInPlace("/project/src/Other.kt");

    // Only one "tasks --all" invocation should occur
    const taskListCalls = vi
      .mocked(execa)
      .mock.calls.filter(
        (call) => Array.isArray(call[1]) && call[1][1] === "tasks",
      );
    expect(taskListCalls).toHaveLength(1);
  });

  it("does not invoke Gradle and does not warn when the wrapper is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(fs.pathExists).mockResolvedValue(false as never);

    const result = await formatKotlinFileInPlace("/project/src/Main.kt");

    expect(result).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("does not invoke the formatter and does not warn when no supported task exists", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout: "compileKotlin - Compiles Kotlin",
    } as never);

    const result = await formatKotlinFileInPlace("/project/src/Main.kt");

    expect(result).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("throws when the selected formatting task fails", async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "spotlessApply - Applies Spotless formatting",
      } as never)
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: "",
      } as never);

    await expect(
      formatKotlinFileInPlace("/project/src/Main.kt"),
    ).rejects.toThrow(/spotlessApply/);
  });
});
