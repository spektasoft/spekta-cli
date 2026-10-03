import prettier from "prettier";
import path from "path";
import fs from "fs-extra";
import { execa } from "execa";
import { formatKotlinFileInPlace } from "./gradle-format-utils";
import {
  isPathWithin,
  resolveWorkspace,
  resolveWorkspaceTarget,
  type WorkspaceContext,
} from "./workspace";

async function runPintInPlace(
  filePath: string,
  workspace?: WorkspaceContext,
): Promise<boolean> {
  const resolvedWorkspace = workspace
    ? await resolveWorkspace(workspace)
    : undefined;
  const pintPath = resolvedWorkspace
    ? path.join(resolvedWorkspace.canonicalRoot, "vendor/bin/pint")
    : "./vendor/bin/pint";
  const cwd = resolvedWorkspace?.canonicalRoot;
  try {
    const pintExists = await fs.pathExists(pintPath);
    if (!pintExists) return false;
    let executablePath = pintPath;
    let targetPath = filePath;
    if (resolvedWorkspace) {
      executablePath = await fs.realpath(pintPath);
      if (!isPathWithin(resolvedWorkspace.canonicalRoot, executablePath)) {
        throw new Error("Pint executable is outside the workspace.");
      }
      targetPath = (await resolveWorkspaceTarget(filePath, resolvedWorkspace))
        .canonicalPath;
    }
    if (cwd) await execa(executablePath, [targetPath], { cwd });
    else await execa(executablePath, [targetPath]);
    return true;
  } catch {
    console.warn(
      `Pint formatting failed for ${filePath}. Falling back to Prettier.`,
    );
    return false;
  }
}

export async function formatFileInPlace(
  filePath: string,
  workspace?: WorkspaceContext,
): Promise<void> {
  const resolvedWorkspace = workspace
    ? await resolveWorkspace(workspace)
    : undefined;
  const targetPath = resolvedWorkspace
    ? (await resolveWorkspaceTarget(filePath, resolvedWorkspace)).canonicalPath
    : filePath;
  const normalizedPath = targetPath.toLowerCase();
  const isPhp = normalizedPath.endsWith(".php");
  const isKotlin =
    normalizedPath.endsWith(".kt") || normalizedPath.endsWith(".kts");

  if (isPhp) {
    if (await runPintInPlace(targetPath, workspace)) return;
  }

  if (isKotlin) {
    if (workspace) await formatKotlinFileInPlace(targetPath, workspace);
    else await formatKotlinFileInPlace(targetPath);
    return;
  }

  try {
    const absolutePath = resolvedWorkspace
      ? targetPath
      : path.resolve(filePath);
    const content = await fs.readFile(absolutePath, "utf-8");
    const options = await prettier.resolveConfig(absolutePath);
    const formatted = await prettier.format(content, {
      ...options,
      filepath: absolutePath,
    });
    if (content !== formatted) {
      await fs.writeFile(absolutePath, formatted, "utf-8");
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Prettier formatting failed for ${filePath}: ${errorMessage}`,
      { cause: err },
    );
  }
}
