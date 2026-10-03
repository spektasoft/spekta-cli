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
