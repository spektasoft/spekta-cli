import { execa } from "execa";
import fs from "fs-extra";
import ignore from "ignore";
import path from "path";
import { getIgnorePatterns } from "../config";

export const RESTRICTED_FILES = [".env", ".gitignore", ".spektaignore"];
const MAX_FILE_SIZE_MB = 10;

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
