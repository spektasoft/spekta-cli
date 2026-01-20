// src/utils/security.ts
import { execa } from "execa";
import path from "path";
import { getIgnorePatterns } from "../config";

const RESTRICTED_FILES = [".env", ".gitignore", ".spektaignore"];

export const validatePathAccess = async (filePath: string): Promise<void> => {
  const fileName = path.basename(filePath);
  const fullPath = path.resolve(filePath);

  if (RESTRICTED_FILES.includes(fileName)) {
    throw new Error(`Access Denied: ${fileName} is a restricted system file.`);
  }

  // Check .spektaignore
  const spektaIgnores = await getIgnorePatterns();
  // Simple check for demonstration; in production use a library like 'ignore'
  const isSpektaIgnored = spektaIgnores.some((p) => filePath.includes(p));
  if (isSpektaIgnored) {
    throw new Error(`Access Denied: ${filePath} is ignored by .spektaignore.`);
  }

  // Check .gitignore via git
  try {
    await execa("git", ["check-ignore", "-q", filePath]);
    // If command succeeds (exit code 0), the file is ignored
    throw new Error(`Access Denied: ${filePath} is ignored by git.`);
  } catch (error: any) {
    if (error.exitCode !== 1) {
      // Exit code 1 means NOT ignored. Any other code means git error or actual ignore.
      if (error.exitCode === 0)
        throw new Error(`Access Denied: ${filePath} is ignored by git.`);
    }
  }
};
