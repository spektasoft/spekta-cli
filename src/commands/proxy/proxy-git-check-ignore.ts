import { execa } from "execa";
import path from "node:path";
import { validateReadPathAccess } from "../../utils/security";
import { resolveWorkspace, type WorkspaceContext } from "../../utils/workspace";
import { findRepositoryRoot } from "./proxy-git-policy";
import type { DiscoveryRenderOutcome } from "./proxy-render-outcome";

const unavailable: DiscoveryRenderOutcome = {
  status: "failure",
  message: "unavailable_access: Path is unavailable.",
  exitCode: 1,
};

const internalFailure: DiscoveryRenderOutcome = {
  status: "failure",
  message: "internal_failure: Git ignore check failed.",
  exitCode: 1,
};

/** Checks one authorized workspace path without exposing Git's rule diagnostics. */
export async function renderGitCheckIgnoreOutcome(
  args: string[],
  context?: WorkspaceContext,
): Promise<DiscoveryRenderOutcome> {
  const operand = args[1] === "--" ? args[2] : args[1];
  if (operand === undefined) return unavailable;

  let workspace: Awaited<ReturnType<typeof resolveWorkspace>>;
  let canonicalPath: string;
  try {
    workspace = await resolveWorkspace(context);
    canonicalPath = await validateReadPathAccess(operand, workspace, {
      gitIgnoreAlreadyChecked: true,
    });
  } catch {
    return unavailable;
  }

  let repositoryRoot: string;
  try {
    repositoryRoot = findRepositoryRoot(context);
  } catch {
    return internalFailure;
  }

  const suppliedPath = path.resolve(workspace.root, operand);
  const targets = [...new Set([suppliedPath, canonicalPath])].map((target) =>
    path.relative(repositoryRoot, target).split(path.sep).join("/"),
  );
  if (
    targets.some(
      (target) =>
        target === ".." ||
        target.startsWith(`..${path.posix.sep}`) ||
        path.posix.isAbsolute(target),
    )
  ) {
    return unavailable;
  }

  try {
    for (const target of targets) {
      const result = await execa(
        "git",
        ["check-ignore", "-q", "--no-index", "--", target],
        { cwd: repositoryRoot, reject: false },
      );
      if (result.exitCode === 0) {
        return { status: "success", content: "git_ignored", truncated: false };
      }
      if (result.exitCode !== 1) return internalFailure;
    }
    return {
      status: "success",
      content: "not_git_ignored",
      truncated: false,
    };
  } catch {
    return internalFailure;
  }
}
