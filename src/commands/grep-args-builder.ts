import fs from "fs-extra";
import path from "node:path";
import { getAssetPaths, HOME_IGNORE } from "../core/config";
import { RESTRICTED_FILES } from "../utils/security";

export interface GrepOptions {
  pattern: string;
  path?: string;
  globs?: string;
  case_insensitive?: boolean;
}

async function buildIgnoreArgs(
  options: GrepOptions,
  workspaceRoot: string,
): Promise<string[]> {
  const args: string[] = [];
  const { globs } = options;

  if (globs) {
    for (const glob of globs.split(",")) {
      if (glob) args.push("-g", glob);
    }
  }

  const { ASSET_DEFAULT_IGNORE } = getAssetPaths();
  if (await fs.pathExists(ASSET_DEFAULT_IGNORE)) {
    args.push("--ignore-file", ASSET_DEFAULT_IGNORE);
  }
  if (await fs.pathExists(HOME_IGNORE)) {
    args.push("--ignore-file", HOME_IGNORE);
  }

  const workspaceIgnore = path.join(workspaceRoot, ".spektaignore");
  if (await fs.pathExists(workspaceIgnore)) {
    args.push("--ignore-file", workspaceIgnore);
  }

  // Mandatory exclusions follow user globs so a positive glob cannot override them.
  for (const restricted of RESTRICTED_FILES) {
    args.push("-g", `!**/${restricted}`);
  }
  return args;
}

export async function buildGrepArgs(
  options: GrepOptions,
  workspaceRoot = process.cwd(),
): Promise<string[]> {
  const { pattern, path: searchPath = ".", case_insensitive } = options;

  const args = [
    "--no-config",
    "--no-follow",
    "--regexp",
    pattern,
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

  args.push(...(await buildIgnoreArgs(options, workspaceRoot)));
  args.push("--", searchPath);
  return args;
}

/** Builds the filename-only rg invocation used to find whitelisted Git-ignored paths. */
export async function buildGrepFileListArgs(
  options: GrepOptions,
  workspaceRoot = process.cwd(),
  searchPath = ".",
  includeGitIgnored = true,
): Promise<string[]> {
  return [
    "--files",
    "--null",
    ...(includeGitIgnored ? ["--no-ignore-vcs"] : []),
    "--no-config",
    "--no-follow",
    "--no-require-git",
    ...(await buildIgnoreArgs(options, workspaceRoot)),
    "--",
    searchPath,
  ];
}
