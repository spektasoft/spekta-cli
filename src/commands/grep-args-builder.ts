import fs from "fs-extra";
import path from "node:path";
import { getAssetPaths, HOME_IGNORE } from "../core/config";

export interface GrepOptions {
  pattern: string;
  path?: string;
  globs?: string;
  case_insensitive?: boolean;
}

export async function buildGrepArgs(options: GrepOptions): Promise<string[]> {
  const { pattern, path: searchPath = ".", globs, case_insensitive } = options;

  const args = [
    pattern,
    searchPath,
    "--line-number",
    "--column",
    "--color=never",
    "--heading",
    "--smart-case",
    "--json",
    // Force ignore-file processing even when rg cannot confirm a git root
    // (e.g. via a linked bin, an unusual cwd, or a nested search path).
    // Without this, .gitignore files anywhere in the tree are silently
    // skipped, including blanket-ignore folders like "spekta/.gitignore".
    "--no-require-git",
  ];

  if (case_insensitive === true) {
    args.push("--ignore-case");
  } else if (case_insensitive === false) {
    args.push("--case-sensitive");
  }

  if (globs) {
    for (const g of globs.split(",")) {
      if (g) args.push("-g", g);
    }
  }

  const { ASSET_DEFAULT_IGNORE } = getAssetPaths();
  if (await fs.pathExists(ASSET_DEFAULT_IGNORE)) {
    args.push("--ignore-file", ASSET_DEFAULT_IGNORE);
  }
  if (await fs.pathExists(HOME_IGNORE)) {
    args.push("--ignore-file", HOME_IGNORE);
  }

  const workspaceIgnore = path.join(process.cwd(), ".spektaignore");
  if (await fs.pathExists(workspaceIgnore)) {
    args.push("--ignore-file", workspaceIgnore);
  }

  return args;
}
