import { execSync } from "child_process";
import { Logger } from "../../utils/logger";

export interface GlobalPromptContext {
  cwd: string;
  git_diff: string;
  timestamp: string;
  [key: string]: any;
}

export const getSafeGitDiff = (): string => {
  try {
    // Run a tightly controlled, safe read-only git command
    const diff = execSync("git diff --no-ext-diff", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return diff.trim();
  } catch (err) {
    Logger.warn(`Could not retrieve git diff for prompt context: ${err}`);
    return "";
  }
};

/**
 * Global prompt context provider for Nunjucks templates.
 * Exposes safe environment variables like cwd, git_diff, and timestamp.
 */
export const getGlobalPromptContext = (
  extraContext: Record<string, any> = {},
): GlobalPromptContext => {
  return {
    cwd: process.cwd(),
    git_diff: getSafeGitDiff(),
    timestamp: new Date().toISOString(),
    ...extraContext,
  };
};
