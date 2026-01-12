import { execSync } from "child_process";

export const getGitDiff = (start: string, end: string): string => {
  try {
    return execSync(`git diff ${start}..${end}`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(
      `Git error: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
};
