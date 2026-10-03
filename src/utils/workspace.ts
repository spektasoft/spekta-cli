import fs from "fs-extra";
import path from "node:path";

export interface WorkspaceContext {
  root: string;
}

export interface ResolvedWorkspace {
  root: string;
  canonicalRoot: string;
}

export function isPathWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export async function resolveWorkspace(
  context: WorkspaceContext = { root: process.cwd() },
): Promise<ResolvedWorkspace> {
  const root = path.resolve(context.root);
  const canonicalRoot = await fs.realpath(root);
  if (!(await fs.stat(canonicalRoot)).isDirectory()) {
    throw new Error(
      `Access Denied: Workspace '${context.root}' is not a directory.`,
    );
  }
  return { root, canonicalRoot };
}

function outside(target: string): Error {
  return new Error(
    `Access Denied: ${target} is outside the project directory.`,
  );
}

export async function resolveWorkspaceTarget(
  targetPath: string,
  workspace: ResolvedWorkspace,
): Promise<{ absolutePath: string; canonicalPath: string }> {
  const absolutePath = path.resolve(workspace.root, targetPath);
  if (
    !isPathWithin(workspace.root, absolutePath) &&
    !isPathWithin(workspace.canonicalRoot, absolutePath)
  ) {
    throw outside(targetPath);
  }

  let canonicalPath: string;
  try {
    canonicalPath = await fs.realpath(absolutePath);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;

    let ancestor = absolutePath;
    while (true) {
      try {
        await fs.lstat(ancestor);
        break;
      } catch (ancestorError: unknown) {
        if ((ancestorError as NodeJS.ErrnoException).code !== "ENOENT") {
          throw ancestorError;
        }
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw ancestorError;
        ancestor = parent;
      }
    }

    const canonicalAncestor = await fs.realpath(ancestor);
    if (!isPathWithin(workspace.canonicalRoot, canonicalAncestor)) {
      throw outside(targetPath);
    }
    throw new Error(`Access Denied: The path '${targetPath}' does not exist.`, {
      cause: error,
    });
  }

  if (!isPathWithin(workspace.canonicalRoot, canonicalPath)) {
    throw outside(targetPath);
  }
  return { absolutePath, canonicalPath };
}

/**
 * Resolves a path for a mutation while checking every existing component.
 * Unlike resolveWorkspaceTarget, this can optionally resolve a path that does
 * not exist yet, provided its deepest existing ancestor is inside the
 * workspace and is a directory.
 */
export async function resolveWorkspaceMutationTarget(
  targetPath: string,
  workspace: ResolvedWorkspace,
  allowMissing = false,
): Promise<{ absolutePath: string; canonicalPath: string }> {
  const absolutePath = path.resolve(workspace.root, targetPath);
  const lexicalRoot = isPathWithin(workspace.root, absolutePath)
    ? workspace.root
    : isPathWithin(workspace.canonicalRoot, absolutePath)
      ? workspace.canonicalRoot
      : undefined;

  if (!lexicalRoot) throw outside(targetPath);

  // The workspace root itself may be a symlink, but it must still resolve to
  // the canonical root that was established when the workspace was created.
  const rootPath = await fs.realpath(lexicalRoot);
  if (rootPath !== workspace.canonicalRoot) throw outside(targetPath);

  const relativePath = path.relative(lexicalRoot, absolutePath);
  const segments = relativePath === "" ? [] : relativePath.split(path.sep);
  let currentLexicalPath = lexicalRoot;
  let currentCanonicalPath = workspace.canonicalRoot;

  for (let index = 0; index < segments.length; index += 1) {
    currentLexicalPath = path.join(currentLexicalPath, segments[index]);
    let stat: fs.Stats;
    try {
      stat = await fs.lstat(currentLexicalPath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!allowMissing) {
        throw new Error(
          `Access Denied: The path '${targetPath}' does not exist.`,
          {
            cause: error,
          },
        );
      }

      // ENOENT from lstat identifies a missing component. Any later components
      // are necessarily missing too; append them to the last checked ancestor.
      const missing = segments.slice(index);
      const canonicalPath = path.resolve(currentCanonicalPath, ...missing);
      if (!isPathWithin(workspace.canonicalRoot, canonicalPath)) {
        throw outside(targetPath);
      }
      return { absolutePath, canonicalPath };
    }

    const canonicalComponent = await fs.realpath(currentLexicalPath);
    if (!isPathWithin(workspace.canonicalRoot, canonicalComponent)) {
      throw outside(targetPath);
    }
    currentCanonicalPath = canonicalComponent;

    if (index < segments.length - 1) {
      // realpath above follows symlinks, so stat confirms that each existing
      // ancestor can contain the next path component.
      if (!stat.isSymbolicLink() && !stat.isDirectory()) {
        throw new Error(
          `Access Denied: The parent of '${targetPath}' is not a directory.`,
        );
      }
      if (!(await fs.stat(currentLexicalPath)).isDirectory()) {
        throw new Error(
          `Access Denied: The parent of '${targetPath}' is not a directory.`,
        );
      }
    }
  }

  return { absolutePath, canonicalPath: currentCanonicalPath };
}
