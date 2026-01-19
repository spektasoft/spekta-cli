import { execa } from "execa";

export const isValidHash = (hash: string): boolean => {
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
  ignorePatterns: string[] = [],
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

/**
 * Resolves a git reference (like HEAD or a short hash) to a full 40-character hash.
 */
export const resolveHash = async (ref: string): Promise<string> => {
  try {
    const { stdout } = await execa("git", [
      "rev-parse",
      "--verify",
      `${ref}^{commit}`,
    ]);
    return stdout.trim();
  } catch (error: any) {
    throw new Error(`Hash ${ref} does not resolve to a valid commit.`);
  }
};

/**
 * Finds the most recent merge commit hash.
 */
export const getNearestMerge = async (): Promise<string | null> => {
  try {
    const { stdout } = await execa("git", [
      "log",
      "--merges",
      "-n",
      "1",
      "--format=%H",
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
};

/**
 * Finds the initial commit hash of the repository.
 */
export const getInitialCommit = async (): Promise<string> => {
  try {
    const { stdout } = await execa("git", [
      "rev-list",
      "--max-parents=0",
      "HEAD",
    ]);
    // rev-list returns all roots; we take the first one (usually just one)
    return stdout.trim().split("\n")[0];
  } catch (error: any) {
    throw new Error(`Failed to find initial commit: ${error.message}`);
  }
};

/**
 * Retrieves the git diff for staged changes.
 * @param ignorePatterns - List of patterns to exclude from the diff.
 * @returns A promise that resolves to the diff string.
 */
export const getStagedDiff = async (
  ignorePatterns: string[] = [],
): Promise<string> => {
  const pathspecs = ignorePatterns.map((p) => `:!${p}`);
  const args = ["diff", "--staged", "--", ".", ...pathspecs];

  try {
    const { stdout } = await execa("git", args, {
      all: true,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    return stdout.trim();
  } catch (error: any) {
    const message = error.stderr || error.message;
    throw new Error(`Git staged diff failed: ${message}`);
  }
};

/**
 * Retrieves commit messages between two hashes in reverse chronological order.
 * @param start - The older commit hash.
 * @param end - The newer commit hash.
 * @returns A promise resolving to a formatted string of commit messages.
 */
export const getCommitMessages = async (
  start: string,
  end: string,
): Promise<string> => {
  const args = ["log", "--format=%B%n---", "--reverse", `${start}..${end}`];

  try {
    const { stdout } = await execa("git", args);
    return stdout.trim();
  } catch (error: any) {
    const message = error.stderr || error.message;
    throw new Error(`Failed to get commit messages: ${message}`);
  }
};

export async function commitWithFile(filePath: string): Promise<void> {
  console.log(`Would commit using: git commit --file ${filePath}`);
}

export function stripCodeFences(content: string): string {
  // Remove common outer markdown code fences
  const trimmed = content.trim();

  // Matches ```lang ... ``` or ``` ... ```
  const fenceRegex = /^```(?:\w+)?\s*([\s\S]*?)\s*```$/;
  const match = trimmed.match(fenceRegex);

  if (match && match[1]) {
    return match[1].trim();
  }

  // Fallback: just trim if no clear fence
  return trimmed;
}

export async function formatWithPrettier(filePath: string): Promise<void> {
  try {
    await execa("npx", ["prettier", "--write", filePath], {
      stdio: "ignore", // suppress prettier output
    });
  } catch (err: any) {
    console.warn(
      `Prettier formatting failed: ${err.message}. Continuing with unformatted message.`,
    );
    // Do not throw – better partial success than abort
  }
}
