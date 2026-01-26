import { execa } from "execa";
import fs from "fs-extra";
import ignore from "ignore";
import path from "path";
import { getIgnorePatterns } from "../config";

export const RESTRICTED_FILES = [".env", ".gitignore", ".spektaignore"];
const MAX_FILE_SIZE_MB = 10;

/**
 * Finds the deepest existing ancestor directory for a given path.
 * Walks up the directory tree until an existing directory is found.
 * Returns the absolute path of the existing ancestor.
 */
export async function findExistingAncestor(
  targetPath: string,
): Promise<string> {
  let currentPath = path.resolve(targetPath);

  while (currentPath !== path.parse(currentPath).root) {
    if (await fs.pathExists(currentPath)) {
      const stats = await fs.stat(currentPath);
      if (stats.isDirectory()) {
        return currentPath;
      }
    }
    currentPath = path.dirname(currentPath);
  }

  // If we reach the filesystem root, return it
  return currentPath;
}

export const validatePathAccess = async (filePath: string): Promise<void> => {
  const absolutePath = path.resolve(filePath);
  const fileName = path.basename(absolutePath);
  const relativePath = path.relative(process.cwd(), absolutePath);

  // 1. System File Block
  if (RESTRICTED_FILES.includes(fileName)) {
    throw new Error(`Access Denied: ${fileName} is a restricted system file.`);
  }

  // 2. Out-of-bounds Block: Prevent reading outside project root
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `Access Denied: ${filePath} is outside the project directory.`,
    );
  }

  // 3. Spektaignore Check
  const spektaIgnores = await getIgnorePatterns();
  const ig = ignore().add(spektaIgnores);
  if (ig.ignores(relativePath)) {
    throw new Error(`Access Denied: ${filePath} is ignored by .spektaignore.`);
  }

  // 4. Gitignore Check
  let isGitIgnored = false;
  try {
    // git check-ignore returns exitCode 0 if the file IS ignored.
    await execa("git", ["check-ignore", "-q", filePath]);
    isGitIgnored = true;
  } catch (error: any) {
    // execa throws on non-zero exitCode (1 means NOT ignored).
    // We swallow the error here as it implies the file is safe to access (relative to git).
  }

  if (isGitIgnored) {
    throw new Error(`Access Denied: ${filePath} is ignored by git.`);
  }

  // 5. File Size Check
  const stats = await fs.stat(absolutePath);
  if (stats.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    throw new Error(
      `Access Denied: File exceeds size limit (${MAX_FILE_SIZE_MB}MB).`,
    );
  }
};

export const validatePathAccessForWrite = async (
  filePath: string,
): Promise<void> => {
  const absolutePath = path.resolve(filePath);
  const fileName = path.basename(absolutePath);
  const relativePath = path.relative(process.cwd(), absolutePath);

  // 1. System File Block
  if (RESTRICTED_FILES.includes(fileName)) {
    throw new Error(`Access Denied: ${fileName} is a restricted system file.`);
  }

  // 2. Out-of-bounds Block: Prevent reading outside project root
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `Access Denied: ${filePath} is outside the project directory.`,
    );
  }

  // 3. Spektaignore Check
  const spektaIgnores = await getIgnorePatterns();
  const ig = ignore().add(spektaIgnores);
  if (ig.ignores(relativePath)) {
    throw new Error(`Access Denied: ${filePath} is ignored by .spektaignore.`);
  }

  // 4. Gitignore Check (for the target file path, even though it doesn't exist yet)
  let isGitIgnored = false;
  try {
    // git check-ignore returns exitCode 0 if the file WOULD BE ignored.
    await execa("git", ["check-ignore", "-q", filePath]);
    isGitIgnored = true;
  } catch (error: any) {
    // execa throws on non-zero exitCode (1 means NOT ignored).
  }

  if (isGitIgnored) {
    throw new Error(`Access Denied: ${filePath} would be ignored by git.`);
  }

  // Note: File size check is intentionally omitted since file doesn't exist
};

/**
 * Validates that a file is tracked by git.
 * Edit operations should only be performed on tracked files to ensure safety.
 */
export const validateGitTracked = async (filePath: string): Promise<void> => {
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(process.cwd(), absolutePath);

  try {
    // git ls-files --error-unmatch returns exit code 0 if file is tracked
    await execa("git", ["ls-files", "--error-unmatch", relativePath]);
  } catch (error: any) {
    throw new Error(
      `Edit Denied: ${filePath} is not tracked by git. Only tracked files can be edited.`,
    );
  }
};

/**
 * Combined validation for edit operations.
 * Ensures file passes both access and git tracking checks.
 */
export const validateEditAccess = async (filePath: string): Promise<void> => {
  await validatePathAccess(filePath);
  await validateGitTracked(filePath);
};

/**
 * Validates that the parent directory of a path exists and is git-tracked.
 * Used for safe creation of new files.
 */
export const validateParentDirForCreate = async (
  filePath: string,
): Promise<void> => {
  const absolutePath = path.resolve(filePath);
  const parentDir = path.dirname(absolutePath);
  const relativeParent = path.relative(process.cwd(), parentDir);

  // Must be inside project root
  if (relativeParent.startsWith("..") || path.isAbsolute(relativeParent)) {
    throw new Error(`Parent directory is outside project root: ${parentDir}`);
  }

  // Directory must exist
  if (!(await fs.pathExists(parentDir))) {
    throw new Error(`Parent directory does not exist: ${parentDir}`);
  }

  // Verify we are inside a git repository
  try {
    await execa("git", ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new Error(
      `Parent directory is not in a git repository: ${parentDir}`,
    );
  }
};
