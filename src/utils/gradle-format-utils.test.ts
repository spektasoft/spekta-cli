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
import path from "path";
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
  const projectRoot = path.resolve("project");
  const kotlinFile = path.join(projectRoot, "src", "Main.kt");

  function wrapperPath(name: string): string {
    return path.join(projectRoot, name);
  }

  function expectFormatterCall(call: number, task: string): void {
    if (os.platform() === "win32") {
      expect(execa).toHaveBeenNthCalledWith(
        call,
        wrapperPath("gradlew.bat"),
        [task],
        expect.objectContaining({ cwd: projectRoot, reject: false }),
      );
      return;
    }

    expect(execa).toHaveBeenNthCalledWith(
      call,
      "bash",
      [wrapperPath("gradlew"), task],
      expect.objectContaining({ cwd: projectRoot, reject: false }),
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    clearGradleTaskCache();
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
    await formatKotlinFileInPlace(kotlinFile);

    expect(execa).toHaveBeenNthCalledWith(
      1,
      "bash",
      [wrapperPath("gradlew"), "tasks", "--all"],
      expect.objectContaining({
        cwd: projectRoot,
        reject: false,
      }),
    );
    expect(execa).toHaveBeenNthCalledWith(
      2,
      "bash",
      [wrapperPath("gradlew"), "spotlessApply"],
      expect.objectContaining({ cwd: projectRoot, reject: false }),
    );
  });

  it("uses gradlew through bash on macOS", async () => {
    vi.mocked(os.platform).mockReturnValue("darwin");

    await formatKotlinFileInPlace(kotlinFile);

    expect(execa).toHaveBeenNthCalledWith(
      1,
      "bash",
      [wrapperPath("gradlew"), "tasks", "--all"],
      expect.objectContaining({
        cwd: projectRoot,
        reject: false,
      }),
    );
    expect(execa).toHaveBeenNthCalledWith(
      2,
      "bash",
      [wrapperPath("gradlew"), "spotlessApply"],
      expect.objectContaining({ cwd: projectRoot, reject: false }),
    );
  });

  it("uses gradlew.bat directly on Windows", async () => {
    vi.mocked(os.platform).mockReturnValue("win32");

    await formatKotlinFileInPlace(kotlinFile);

    expect(execa).toHaveBeenNthCalledWith(
      1,
      wrapperPath("gradlew.bat"),
      ["tasks", "--all"],
      expect.objectContaining({ cwd: projectRoot, reject: false }),
    );
    expect(execa).toHaveBeenNthCalledWith(
      2,
      wrapperPath("gradlew.bat"),
      ["spotlessApply"],
      expect.objectContaining({ cwd: projectRoot, reject: false }),
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

    await formatKotlinFileInPlace(kotlinFile);

    expectFormatterCall(2, "spotlessApply");
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

    await formatKotlinFileInPlace(kotlinFile);

    expectFormatterCall(2, "ktlintFormat");
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

    await formatKotlinFileInPlace(kotlinFile);

    expectFormatterCall(2, "formatKotlin");
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

    await formatKotlinFileInPlace(kotlinFile);

    expectFormatterCall(2, "spotlessApply");
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

    await formatKotlinFileInPlace(kotlinFile);
    await formatKotlinFileInPlace(path.join(projectRoot, "src", "Other.kt"));

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

    const result = await formatKotlinFileInPlace(kotlinFile);

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

    const result = await formatKotlinFileInPlace(kotlinFile);

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

    await expect(formatKotlinFileInPlace(kotlinFile)).rejects.toThrow(
      /spotlessApply/,
    );
  });
});
