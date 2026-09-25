import fs from "fs-extra";
import os from "os";
import path from "path";
import { execa } from "execa";

const FORMAT_TASKS = [
  "spotlessApply",
  "spotlessKotlinApply",
  "ktlintFormat",
  "formatKotlin",
  "ktfmtFormat",
] as const;

type FormatTask = (typeof FORMAT_TASKS)[number];

const projectTaskCache = new Map<string, FormatTask | null>();

export function clearGradleTaskCache(): void {
  projectTaskCache.clear();
}

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

interface GradleExecutionResult {
  exitCode?: number;
  stdout: string;
}

async function executeGradleWrapper(
  projectRoot: string,
  args: string[],
): Promise<GradleExecutionResult> {
  const wrapperName = getGradleWrapperName();
  const wrapperPath = path.join(projectRoot, wrapperName);

  return os.platform() === "win32"
    ? execa(wrapperPath, args, {
        cwd: projectRoot,
        reject: false,
      })
    : execa("bash", [wrapperPath, ...args], {
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
  if (projectTaskCache.has(projectRoot)) {
    return projectTaskCache.get(projectRoot) ?? null;
  }

  const output = await getAvailableGradleTasks(projectRoot);

  for (const task of FORMAT_TASKS) {
    for (const line of output) {
      const normalized = line.trim();
      if (
        normalized === task ||
        normalized.startsWith(`${task} -`) ||
        normalized.startsWith(`${task} `)
      ) {
        projectTaskCache.set(projectRoot, task);
        return task;
      }

      const subprojectMatch = normalized.match(
        new RegExp(`^(?:[:\\w-]+:)?(${task})(?:\\s|$)`),
      );
      if (subprojectMatch) {
        projectTaskCache.set(projectRoot, task);
        return task;
      }
    }
  }

  projectTaskCache.set(projectRoot, null);
  return null;
}

export async function formatKotlinFileInPlace(
  filePath: string,
): Promise<boolean> {
  const projectRoot = await findGradleProjectRoot(filePath);

  if (!projectRoot) {
    return false;
  }

  const task = await findFormattingTask(projectRoot);

  if (!task) {
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
