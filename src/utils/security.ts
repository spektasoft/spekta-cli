import { execa } from "execa";
import fs from "fs-extra";
import ignore from "ignore";
import path from "path";
import { assertPathNotIgnored } from "./path-ignore";
import {
  isPathWithin,
  resolveWorkspace,
  resolveWorkspaceMutationTarget,
  resolveWorkspaceTarget,
  type ResolvedWorkspace,
} from "./workspace";

export const RESTRICTED_FILES = [".env", ".gitignore", ".spektaignore"];
const MAX_FILE_SIZE_MB = 10;

/**
 * Finds the deepest existing ancestor directory for a given path.
 * Walks up the directory tree until an existing directory is found.
 * Returns the absolute path of the existing ancestor.
 */
export async function findExistingAncestor(
  targetPath: string,
): Promise<string> {
  let currentPath = path.resolve(targetPath);

  while (currentPath !== path.parse(currentPath).root) {
    if (await fs.pathExists(currentPath)) {
      const stats = await fs.stat(currentPath);
      if (stats.isDirectory()) {
        return currentPath;
      }
    }
    currentPath = path.dirname(currentPath);
  }

  // If we reach the filesystem root, return it
  return currentPath;
}

/**
 * Determines if a path is explicitly whitelisted by negation patterns (!)
 * in the spektaignore configuration.
 */
export const isWhitelisted = (path: string, patterns: string[]): boolean => {
  const whitelistPatterns = patterns
    .filter((p) => p.startsWith("!"))
    .map((p) => p.slice(1));

  if (whitelistPatterns.length === 0) return false;

  const ig = ignore().add(whitelistPatterns);
  return ig.ignores(path);
};

export const validatePathAccess = async (
  targetPath: string,
  options: {
    gitNoIndex?: boolean;
    skipGitIgnoreCheck?: boolean;
    workspaceRoot?: string;
    displayPath?: string;
  } = {},
): Promise<void> => {
  const root = options.workspaceRoot ?? process.cwd();
  const displayPath = options.displayPath ?? targetPath;
  const absolutePath = path.resolve(root, targetPath);
  const fileName = path.basename(absolutePath);
  const relativePath = path.relative(root, absolutePath);

  if (RESTRICTED_FILES.includes(fileName)) {
    throw new Error(`Access Denied: ${fileName} is a restricted system file.`);
  }

  const outside =
    options.workspaceRoot === undefined
      ? relativePath.startsWith("..") || path.isAbsolute(relativePath)
      : !isPathWithin(root, absolutePath);
  if (outside) {
    throw new Error(
      `Access Denied: ${displayPath} is outside the project directory.`,
    );
  }

  if (relativePath !== "") {
    const ignoreOptions = { gitNoIndex: options.gitNoIndex };
    if (options.workspaceRoot === undefined) {
      await assertPathNotIgnored(relativePath, displayPath, ignoreOptions);
    } else {
      await assertPathNotIgnored(
        relativePath,
        displayPath,
        ignoreOptions,
        root,
        options.skipGitIgnoreCheck,
      );
    }
  }

  try {
    const stats = await fs.stat(absolutePath);
    if (stats.isFile() && stats.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      throw new Error(
        `Access Denied: File exceeds size limit (${MAX_FILE_SIZE_MB}MB).`,
      );
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Access Denied: The path '${displayPath}' does not exist.`,
        { cause: error },
      );
    }
    throw error;
  }
};

export const validateReadPathAccess = async (
  targetPath: string,
  workspace: ResolvedWorkspace,
  options: { gitIgnoreAlreadyChecked?: boolean } = {},
): Promise<string> => {
  const requestedName = path.basename(path.resolve(workspace.root, targetPath));
  if (RESTRICTED_FILES.includes(requestedName)) {
    throw new Error(
      `Access Denied: ${requestedName} is a restricted system file.`,
    );
  }
  const { absolutePath, canonicalPath } = await resolveWorkspaceTarget(
    targetPath,
    workspace,
  );
  const requestedRoot = isPathWithin(workspace.root, absolutePath)
    ? workspace.root
    : workspace.canonicalRoot;
  await validatePathAccess(absolutePath, {
    workspaceRoot: requestedRoot,
    displayPath: targetPath,
    skipGitIgnoreCheck: options.gitIgnoreAlreadyChecked,
  });
  if (
    canonicalPath !== absolutePath ||
    requestedRoot !== workspace.canonicalRoot
  ) {
    await validatePathAccess(canonicalPath, {
      workspaceRoot: workspace.canonicalRoot,
      displayPath: targetPath,
      skipGitIgnoreCheck: options.gitIgnoreAlreadyChecked,
    });
  }
  return canonicalPath;
};

export const validatePathAccessForWrite = async (
  targetPath: string,
  workspace?: ResolvedWorkspace,
): Promise<string> => {
  const resolvedWorkspace = workspace ?? (await resolveWorkspace());
  const { absolutePath, canonicalPath } = await resolveWorkspaceMutationTarget(
    targetPath,
    resolvedWorkspace,
    true,
  );

  validateMutationRestrictedPaths(
    [absolutePath, canonicalPath],
    resolvedWorkspace,
    true,
  );
  await validateMutationIgnorePaths(
    [absolutePath, canonicalPath],
    resolvedWorkspace,
    targetPath,
    { git: "would be" },
  );

  // Note: File size check is intentionally omitted since this API validates
  // paths that may not exist yet.
  return canonicalPath;
};

/**
 * Validates that a file is tracked by git.
 * Retained for callers that explicitly require Git tracking.
 */
export const validateGitTracked = async (targetPath: string): Promise<void> => {
  const absolutePath = path.resolve(targetPath);
  const relativePath = path.relative(process.cwd(), absolutePath);

  try {
    // git ls-files --error-unmatch returns exit code 0 if file is tracked
    await execa("git", ["ls-files", "--error-unmatch", relativePath]);
  } catch (error: unknown) {
    throw new Error(
      `Edit Denied: ${targetPath} is not tracked by git. Only tracked files can be edited.`,
      { cause: error },
    );
  }
};

/**
 * Validates access to an existing file for replacement, regardless of Git tracking.
 */
export const validateEditAccess = async (
  targetPath: string,
  workspace?: ResolvedWorkspace,
): Promise<string> => {
  const resolvedWorkspace = workspace ?? (await resolveWorkspace());
  const { absolutePath, canonicalPath } = await resolveWorkspaceMutationTarget(
    targetPath,
    resolvedWorkspace,
    false,
  );

  validateMutationRestrictedPaths(
    [absolutePath, canonicalPath],
    resolvedWorkspace,
  );
  await validateMutationIgnorePaths(
    [absolutePath, canonicalPath],
    resolvedWorkspace,
    targetPath,
    { gitNoIndex: true },
  );

  // Preserve the existing file-size limit while checking the canonical file.
  const stats = await fs.stat(canonicalPath);
  if (stats.isFile() && stats.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    throw new Error(
      `Access Denied: File exceeds size limit (${MAX_FILE_SIZE_MB}MB).`,
    );
  }
  return canonicalPath;
};

function workspaceRelativePath(
  absolutePath: string,
  workspace: ResolvedWorkspace,
): string {
  if (isPathWithin(workspace.root, absolutePath)) {
    return path.relative(workspace.root, absolutePath);
  }
  return path.relative(workspace.canonicalRoot, absolutePath);
}

function validateMutationRestrictedPaths(
  absolutePaths: string[],
  workspace: ResolvedWorkspace,
  forCreation = false,
): void {
  for (const absolutePath of absolutePaths) {
    const relative = workspaceRelativePath(absolutePath, workspace);
    const segments = relative.split(path.sep).filter(Boolean);
    const restricted = segments.find((segment) =>
      RESTRICTED_FILES.includes(segment),
    );
    if (restricted) {
      if (forCreation) {
        throw new Error(
          `Cannot create file or directories under restricted path segment: ${restricted}`,
        );
      }
      throw new Error(
        `Access Denied: ${restricted} is a restricted system file.`,
      );
    }
  }
}

async function validateMutationIgnorePaths(
  absolutePaths: string[],
  workspace: ResolvedWorkspace,
  displayPath: string,
  verb: { git?: string; gitNoIndex?: boolean },
): Promise<void> {
  const seen = new Set<string>();
  for (const absolutePath of absolutePaths) {
    const relative = workspaceRelativePath(absolutePath, workspace);
    if (!relative || seen.has(relative)) continue;
    seen.add(relative);
    await assertPathNotIgnored(
      relative,
      displayPath,
      verb,
      workspace.canonicalRoot,
    );
  }
}

/**
 * Validates that a file can be safely created at the given path.
 *
 * Two-phase validation approach:
 * 1. Finds the deepest existing ancestor directory by walking up the tree
 * 2. Resolves its real (physical) path to handle symlinks
 * 3. Validates that the real path is within project bounds and git-tracked
 * 4. Ensures no restricted directory names (.env, .gitignore, etc.) appear in path segments
 *
 * This allows creation of nested directory structures while preventing writes
 * outside the project (even via symlinks) or in restricted locations.
 *
 * @param filePath - The path where a new file will be created
 * @throws Error if real path is outside project root
 * @throws Error if not within a git repository
 * @throws Error if path includes restricted directory names
 *
 * @example
 * await validateParentDirForCreate('src/new/feature/file.ts'); // ✓ Valid
 * await validateParentDirForCreate('../outside/file.ts');      // ✗ Throws
 * await validateParentDirForCreate('src/.env/new.ts');         // ✗ Throws (restricted)
 */
export const validateParentDirForCreate = async (
  filePath: string,
  workspace?: ResolvedWorkspace,
): Promise<void> => {
  const resolvedWorkspace = workspace ?? (await resolveWorkspace());
  const requestedAbsolutePath = path.resolve(resolvedWorkspace.root, filePath);
  const requestedParent = path.dirname(requestedAbsolutePath);
  if (
    !isPathWithin(resolvedWorkspace.root, requestedParent) &&
    !isPathWithin(resolvedWorkspace.canonicalRoot, requestedParent)
  ) {
    throw new Error(
      `Parent directory is outside project root: ${requestedParent}`,
    );
  }
  const { absolutePath, canonicalPath } = await resolveWorkspaceMutationTarget(
    filePath,
    resolvedWorkspace,
    true,
  );
  validateMutationRestrictedPaths(
    [absolutePath, canonicalPath],
    resolvedWorkspace,
    true,
  );

  // The resolver has already checked the deepest existing ancestor. Locate
  // that ancestor again to verify the destination remains inside a Git worktree.
  const parentDir = path.dirname(absolutePath);
  const existingAncestor = await findExistingAncestor(parentDir);
  const realAncestor = await fs.realpath(existingAncestor);
  if (!isPathWithin(resolvedWorkspace.canonicalRoot, realAncestor)) {
    throw new Error(
      `Real path of ancestor (after symlink resolution) is outside project root: ${realAncestor}`,
    );
  }

  try {
    await execa("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: realAncestor,
    });
  } catch {
    throw new Error(
      `Not in a git repository. Real ancestor directory: ${realAncestor}`,
    );
  }
};
