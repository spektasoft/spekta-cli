import { execa } from "execa";
import fs from "fs-extra";
import ignore from "ignore";
import path from "path";
import { getIgnorePatterns } from "../config";

const RESTRICTED_FILES = [".env", ".gitignore", ".spektaignore"];
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
  try {
    await execa("git", ["check-ignore", "-q", filePath]);
    throw new Error(`Access Denied: ${filePath} is ignored by git.`);
  } catch (error: any) {
    if (error.exitCode === 0)
      throw new Error(`Access Denied: ${filePath} is ignored by git.`);
    // exitCode 1 is expected (not ignored)
  }

  // 5. File Size Check
  const stats = await fs.stat(absolutePath);
  if (stats.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    throw new Error(
      `Access Denied: File exceeds size limit (${MAX_FILE_SIZE_MB}MB).`,
    );
  }
};
