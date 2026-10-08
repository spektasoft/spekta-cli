import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import os from "os";
import path from "path";
import prettier from "prettier";
import { execa } from "execa";
import { formatFileInPlace } from "./format-utils";
import {
  clearGradleTaskCache,
  formatKotlinFileInPlace,
} from "./gradle-format-utils";

vi.mock("execa", () => ({ execa: vi.fn() }));

const temporaryRoots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spekta-format-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  vi.clearAllMocks();
  clearGradleTaskCache();
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.remove(root)));
});

describe("workspace-bound formatters", () => {
  it("uses each workspace's Prettier config for its own target", async () => {
    const firstRoot = await createRoot();
    const secondRoot = await createRoot();
    const firstFile = path.join(firstRoot, "source.js");
    const secondFile = path.join(secondRoot, "source.js");
    await Promise.all([
      fs.writeJson(path.join(firstRoot, ".prettierrc"), { semi: false }),
      fs.writeJson(path.join(secondRoot, ".prettierrc"), { semi: true }),
      fs.writeFile(firstFile, "const value = 1"),
      fs.writeFile(secondFile, "const value = 1"),
    ]);

    await formatFileInPlace("source.js", { root: firstRoot });
    await formatFileInPlace(secondFile, { root: secondRoot });

    expect(await fs.readFile(firstFile, "utf-8")).toBe("const value = 1\n");
    expect(await fs.readFile(secondFile, "utf-8")).toBe("const value = 1;\n");
    const firstConfig = await prettier.resolveConfig(firstFile);
    expect(firstConfig?.semi).toBe(false);
    expect((await prettier.resolveConfig(secondFile))?.semi).toBe(true);
  });

  it("runs Pint from the supplied workspace and passes the canonical target", async () => {
    const root = await createRoot();
    const file = path.join(root, "src", "Example.php");
    const pint = path.join(root, "vendor", "bin", "pint");
    await fs.ensureDir(path.dirname(file));
    await fs.ensureDir(path.dirname(pint));
    await Promise.all([fs.writeFile(file, "<?php\n"), fs.writeFile(pint, "")]);
    vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: "" } as never);

    await formatFileInPlace(file, { root });

    expect(execa).toHaveBeenCalledWith(pint, [file], { cwd: root });
  });

  it("ignores a Pint symlink that escapes the workspace", async () => {
    const root = await createRoot();
    const outsideRoot = await createRoot();
    const file = path.join(root, "Example.php");
    await fs.writeFile(file, "<?php\n");
    await fs.ensureDir(path.join(root, "vendor", "bin"));
    await fs.writeFile(path.join(outsideRoot, "pint"), "");
    await fs.symlink(
      path.join(outsideRoot, "pint"),
      path.join(root, "vendor", "bin", "pint"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(formatFileInPlace(file, { root })).rejects.toThrow(
      /Prettier formatting failed/,
    );

    expect(execa).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Pint formatting failed"),
    );
    expect(await fs.readFile(file, "utf-8")).toBe("<?php\n");
    warn.mockRestore();
  });

  it("does not use a Gradle wrapper above the workspace boundary", async () => {
    const outerRoot = await createRoot();
    const workspaceRoot = path.join(outerRoot, "workspace");
    const file = path.join(workspaceRoot, "src", "Main.kt");
    await fs.ensureDir(path.join(outerRoot, "gradle", "wrapper"));
    await fs.ensureDir(path.dirname(file));
    await fs.writeFile(path.join(outerRoot, "gradlew"), "");
    await fs.writeFile(file, "class Main\n");

    const result = await formatKotlinFileInPlace(file, {
      root: workspaceRoot,
    });

    expect(result).toBe(false);
    expect(execa).not.toHaveBeenCalled();
  });

  it("runs the discovered Gradle task from the in-workspace project root", async () => {
    const root = await createRoot();
    const file = path.join(root, "app", "src", "Main.kt");
    await fs.ensureDir(path.join(root, "app", "src"));
    await fs.ensureDir(path.join(root, "gradle", "wrapper"));
    await fs.writeFile(path.join(root, "gradlew"), "");
    await fs.writeFile(file, "class Main\n");
    vi.mocked(execa)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "spotlessApply - Applies Kotlin formatting",
      } as never)
      .mockResolvedValueOnce({ exitCode: 0, stdout: "" } as never);

    await expect(
      formatKotlinFileInPlace("app/src/Main.kt", { root }),
    ).resolves.toBe(true);

    expect(execa).toHaveBeenNthCalledWith(
      1,
      "bash",
      [path.join(root, "gradlew"), "tasks", "--all"],
      { cwd: root, reject: false },
    );
    expect(execa).toHaveBeenNthCalledWith(
      2,
      "bash",
      [path.join(root, "gradlew"), "spotlessApply"],
      { cwd: root, reject: false },
    );
  });

  it("preserves explicit-context behavior when Gradle has no formatter task", async () => {
    const root = await createRoot();
    const file = path.join(root, "src", "Main.kt");
    await fs.ensureDir(path.join(root, "gradle", "wrapper"));
    await fs.ensureDir(path.dirname(file));
    await fs.writeFile(path.join(root, "gradlew"), "");
    await fs.writeFile(file, "class Main\n");
    vi.mocked(execa).mockResolvedValue({
      exitCode: 0,
      stdout: "compileKotlin - Compiles Kotlin",
    } as never);

    await expect(formatKotlinFileInPlace(file, { root })).resolves.toBe(false);
    expect(execa).toHaveBeenCalledTimes(1);
  });

  it("preserves explicit-context behavior when the Gradle wrapper is missing", async () => {
    const root = await createRoot();
    const file = path.join(root, "src", "Main.kt");
    await fs.ensureDir(path.dirname(file));
    await fs.writeFile(file, "class Main\n");

    await expect(formatKotlinFileInPlace(file, { root })).resolves.toBe(false);
    expect(execa).not.toHaveBeenCalled();
  });

  it("reports a failed explicit-context Gradle formatting task", async () => {
    const root = await createRoot();
    const file = path.join(root, "src", "Main.kt");
    await fs.ensureDir(path.join(root, "gradle", "wrapper"));
    await fs.ensureDir(path.dirname(file));
    await fs.writeFile(path.join(root, "gradlew"), "");
    await fs.writeFile(file, "class Main\n");
    vi.mocked(execa)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "spotlessApply - Applies Kotlin formatting",
      } as never)
      .mockResolvedValueOnce({ exitCode: 1, stdout: "" } as never);

    await expect(formatKotlinFileInPlace(file, { root })).rejects.toThrow(
      /spotlessApply/,
    );
  });

  it("rejects a Gradle wrapper symlink that escapes the workspace", async () => {
    const root = await createRoot();
    const outsideRoot = await createRoot();
    const file = path.join(root, "src", "Main.kt");
    await fs.ensureDir(path.join(root, "gradle", "wrapper"));
    await fs.ensureDir(path.dirname(file));
    await fs.writeFile(file, "class Main\n");
    await fs.writeFile(path.join(outsideRoot, "gradlew"), "");
    await fs.symlink(
      path.join(outsideRoot, "gradlew"),
      path.join(root, "gradlew"),
    );

    await expect(formatKotlinFileInPlace(file, { root })).rejects.toThrow(
      /outside the workspace/,
    );
    expect(execa).not.toHaveBeenCalled();
  });

  it("rejects a Gradle wrapper directory symlink that escapes the workspace", async () => {
    const root = await createRoot();
    const outsideRoot = await createRoot();
    const file = path.join(root, "src", "Main.kt");
    await fs.ensureDir(path.join(outsideRoot, "gradle", "wrapper"));
    await fs.ensureDir(path.dirname(file));
    await fs.writeFile(path.join(root, "gradlew"), "");
    await fs.symlink(
      path.join(outsideRoot, "gradle"),
      path.join(root, "gradle"),
    );
    await fs.writeFile(file, "class Main\n");

    await expect(formatKotlinFileInPlace(file, { root })).rejects.toThrow(
      /outside the workspace/,
    );
    expect(execa).not.toHaveBeenCalled();
  });

  it("rejects an outside formatter target before reading or formatting it", async () => {
    const root = await createRoot();
    const outsideRoot = await createRoot();
    const outsideFile = path.join(outsideRoot, "outside.js");
    await fs.writeFile(outsideFile, "const outside = true");

    await expect(formatFileInPlace(outsideFile, { root })).rejects.toThrow(
      /outside the project directory/,
    );
    expect(execa).not.toHaveBeenCalled();
    expect(await fs.readFile(outsideFile, "utf-8")).toBe(
      "const outside = true",
    );
  });
});
