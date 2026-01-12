import { execa } from "execa";

const isValidHash = (hash: string): boolean => {
  return /^[0-9a-f]{7,40}$/i.test(hash);
};

/**
 * Retrieves the git diff between two commits.
 * @param start - The older commit hash.
 * @param end - The newer commit hash.
 * @param ignorePatterns - List of patterns to exclude from the diff.
 * @returns A promise that resolves to the diff string.
 */
export const getGitDiff = async (
  start: string,
  end: string,
  ignorePatterns: string[] = []
): Promise<string> => {
  if (!isValidHash(start) || !isValidHash(end)) {
    throw new Error("Invalid commit hash format. Use 7-40 hex characters.");
  }

  const pathspecs = ignorePatterns.map((p) => `:!${p}`);
  const args = ["diff", `${start}..${end}`, "--", ".", ...pathspecs];

  try {
    const { stdout } = await execa("git", args, {
      all: true,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    return stdout;
  } catch (error: any) {
    // Best practice: include the underlying stderr for debugging
    const message = error.stderr || error.message;
    throw new Error(`Git diff failed: ${message}`);
  }
};
