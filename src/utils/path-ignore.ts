import { execa } from "execa";
import ignore from "ignore";
import path from "node:path";
import { getIgnorePatterns } from "../core/config";
import { isWhitelisted } from "./security";

/**
 * Evaluates whether a relative or absolute target path is ignored
 * by spekta ignore configuration or gitignore rules.
 */
export async function isPathIgnored(targetPath: string): Promise<boolean> {
  const absolutePath = path.resolve(targetPath);
  const relativePath = path.relative(process.cwd(), absolutePath);

  if (relativePath === "" || relativePath.startsWith("..")) {
    return false;
  }

  const spektaIgnores = await getIgnorePatterns();
  if (spektaIgnores.length > 0) {
    const ig = ignore().add(spektaIgnores);
    if (ig.ignores(relativePath)) {
      return true;
    }
  }

  let isGitIgnored = false;
  try {
    await execa("git", ["check-ignore", "-q", relativePath]);
    isGitIgnored = true;
  } catch {
    // Non-zero exit code indicates the path is not ignored by git, or git is not initialized.
  }

  if (isGitIgnored) {
    if (isWhitelisted(relativePath, spektaIgnores)) {
      return false;
    }
    return true;
  }

  return false;
}
