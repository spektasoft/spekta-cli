import { execa } from "execa";
import fs from "fs-extra";
import path from "path";
import { HOME_IGNORE } from "../config";

interface GrepOptions {
  pattern: string;
  path?: string;
  globs?: string;
  case_insensitive?: boolean;
}

export async function getGrepContent(options: GrepOptions): Promise<string> {
  const {
    pattern,
    path: searchPath = ".",
    globs,
    case_insensitive = true,
  } = options;

  // 1. Check if rg is installed
  try {
    await execa("rg", ["--version"]);
  } catch {
    throw new Error(
      "ripgrep (rg) is not installed. Please install it (e.g., 'brew install ripgrep' or 'apt install ripgrep') to use the search tool.",
    );
  }

  // 2. Build arguments
  const args = [
    pattern,
    searchPath,
    "--line-number",
    "--column",
    "--color=never",
    "--heading",
    "--smart-case",
  ];

  if (case_insensitive) args.push("--ignore-case");
  if (globs) {
    args.push("-g", globs);
  }

  // 3. Handle .spektaignore
  if (await fs.pathExists(HOME_IGNORE)) {
    args.push("--ignore-file", HOME_IGNORE);
  }

  try {
    const { stdout } = await execa("rg", args);

    if (!stdout.trim()) {
      return "No matches found.";
    }

    return `Search Results for "${pattern}":\n\n\`\`\`text\n${stdout}\n\`\`\``;
  } catch (error: any) {
    // rg returns exit code 1 if no matches are found
    if (error.exitCode === 1) {
      return "No matches found.";
    }
    throw new Error(`Ripgrep error: ${error.message}`);
  }
}
