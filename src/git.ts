import { spawnSync } from "child_process";

const isValidHash = (hash: string): boolean => {
  return /^[0-9a-f]{7,40}$/i.test(hash);
};

export const getGitDiff = (
  start: string,
  end: string,
  ignorePatterns: string[] = []
): string => {
  if (!isValidHash(start) || !isValidHash(end)) {
    throw new Error("Invalid commit hash format. Use 7-40 hex characters.");
  }

  const pathspecs = ignorePatterns.map((p) => `:!${p}`);
  const args = ["diff", `${start}..${end}`, "--", ".", ...pathspecs];

  const result = spawnSync("git", args, {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Git process error: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`Git error: ${result.stderr}`);
  }

  return result.stdout;
};
