import { execSync } from "child_process";

export const getGitDiff = (
  start: string,
  end: string,
  ignorePatterns: string[] = []
): string => {
  try {
    const pathspecs = ignorePatterns.map((p) => `':!${p}'`).join(" ");
    const command = `git diff ${start}..${end} -- . ${pathspecs}`;

    return execSync(command, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(
      `Git error: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
};
