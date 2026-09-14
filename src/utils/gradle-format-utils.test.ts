import { beforeEach, describe, expect, it, vi } from "vitest";

import os from "os";
import fs from "fs-extra";
import { execa } from "execa";

import { formatKotlinFileInPlace } from "./gradle-format-utils";

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
    vi.mocked(os.platform).mockReturnValue("linux");
    vi.mocked(execa).mockResolvedValue({
      exitCode: 0,
      stdout: "spotlessApply - Applies Spotless formatting",
    } as never);
    vi.mocked(fs.pathExists).mockImplementation(async (targetPath) => {
      const normalized = String(targetPath).replace(/\\/g, "/");
      return !normalized.includes("/src/");
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

  it("does not invoke Gradle when the wrapper is missing", async () => {
    vi.mocked(fs.pathExists).mockResolvedValue(false);

    const result = await formatKotlinFileInPlace("/project/src/Main.kt");

    expect(result).toBe(false);
  });

  it("does not invoke the formatter when no supported task exists", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      exitCode: 0,
      stdout: "compileKotlin - Compiles Kotlin",
    } as never);

    const result = await formatKotlinFileInPlace("/project/src/Main.kt");

    expect(result).toBe(false);
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
