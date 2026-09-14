import fs from "fs-extra";
import os from "os";
import path from "path";
import { execa } from "execa";

const FORMAT_TASKS = ["spotlessApply", "ktlintFormat"] as const;

type FormatTask = (typeof FORMAT_TASKS)[number];

function getGradleWrapperName(platform = os.platform()): string {
  return platform === "win32" ? "gradlew.bat" : "gradlew";
}

async function findGradleProjectRoot(filePath: string): Promise<string | null> {
  let current = path.dirname(path.resolve(filePath));

  while (true) {
    const wrapperPath = path.join(current, getGradleWrapperName());
    const wrapperDirectory = path.join(current, "gradle", "wrapper");

    if (
      (await fs.pathExists(wrapperPath)) &&
      (await fs.pathExists(wrapperDirectory))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function executeGradleWrapper(
  projectRoot: string,
  args: string[],
): Promise<ReturnType<typeof execa>> {
  const wrapperName = getGradleWrapperName();
  const wrapperPath = path.join(projectRoot, wrapperName);

  return os.platform() === "win32"
    ? await execa(wrapperPath, args, {
        cwd: projectRoot,
        reject: false,
      })
    : await execa("bash", [wrapperPath, ...args], {
        cwd: projectRoot,
        reject: false,
      });
}

async function getAvailableGradleTasks(projectRoot: string): Promise<string[]> {
  const result = await executeGradleWrapper(projectRoot, ["tasks", "--all"]);

  if (result.exitCode !== 0) {
    return [];
  }

  return result.stdout.split(/\r?\n/);
}

async function findFormattingTask(
  projectRoot: string,
): Promise<FormatTask | null> {
  const output = await getAvailableGradleTasks(projectRoot);

  for (const task of FORMAT_TASKS) {
    if (
      output.some((line) => {
        const normalized = line.trim();
        return (
          normalized === task ||
          normalized.startsWith(`${task} -`) ||
          normalized.startsWith(`${task} `)
        );
      })
    ) {
      return task;
    }
  }

  return null;
}

export async function formatKotlinFileInPlace(
  filePath: string,
): Promise<boolean> {
  const projectRoot = await findGradleProjectRoot(filePath);

  if (!projectRoot) {
    console.warn(
      `Kotlin formatting skipped for ${filePath}: Gradle Wrapper not found.`,
    );
    return false;
  }

  const task = await findFormattingTask(projectRoot);

  if (!task) {
    console.warn(
      `Kotlin formatting skipped for ${filePath}: no supported Gradle formatting task found.`,
    );
    return false;
  }

  const result = await executeGradleWrapper(projectRoot, [task]);

  if (result.exitCode !== 0) {
    throw new Error(
      `Gradle Kotlin formatting task "${task}" failed for ${filePath}.`,
    );
  }

  return true;
}
