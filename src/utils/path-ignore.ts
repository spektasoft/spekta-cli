import { execa } from "execa";
import ignore from "ignore";
import path from "node:path";
import { getIgnorePatterns } from "../core/config";
import { isWhitelisted } from "./security";
import { isPathWithin } from "./workspace";

/**
 * Evaluates whether a relative or absolute target path is ignored
 * by spekta ignore configuration or gitignore rules.
 */
type IgnoreRuleMatch = "spekta" | "git" | null;

interface IgnoreCheckResult {
  match: IgnoreRuleMatch;
  spektaIgnores: string[];
}

/**
 * Runs the shared spekta-ignore / git-ignore checks for an already-resolved
 * relative path. Returns which rule matched (if any) along with the
 * resolved spekta ignore patterns, so callers decide whether to throw
 * and with which message.
 */
async function checkIgnoreRule(
  relativePath: string,
  patternsOverride?: string[],
  gitNoIndex = false,
  workspaceRoot?: string,
): Promise<IgnoreCheckResult> {
  const spektaIgnores =
    patternsOverride ??
    (await (workspaceRoot === undefined
      ? getIgnorePatterns()
      : getIgnorePatterns(workspaceRoot)));

  if (spektaIgnores.length > 0) {
    const ig = ignore().add(spektaIgnores);
    if (ig.ignores(relativePath)) {
      return { match: "spekta", spektaIgnores };
    }
  }

  let isGitIgnored = false;
  try {
    const args = [
      "check-ignore",
      "-q",
      ...(gitNoIndex ? ["--no-index"] : []),
      relativePath,
    ];
    if (workspaceRoot === undefined) {
      await execa("git", args);
    } else {
      await execa("git", args, { cwd: workspaceRoot });
    }
    isGitIgnored = true;
  } catch {
    // Non-zero exit code indicates the path is not ignored by git, or git is not initialized.
  }

  if (isGitIgnored && !isWhitelisted(relativePath, spektaIgnores)) {
    return { match: "git", spektaIgnores };
  }

  return { match: null, spektaIgnores };
}

export async function isPathIgnored(
  targetPath: string,
  patternsOverride?: string[],
  workspaceRoot?: string,
): Promise<boolean> {
  const root = workspaceRoot ?? process.cwd();
  const absolutePath = path.resolve(root, targetPath);
  const relativePath = path.relative(root, absolutePath);
  const outside =
    workspaceRoot === undefined
      ? relativePath.startsWith("..")
      : !isPathWithin(root, absolutePath);

  if (relativePath === "" || outside) {
    return false;
  }

  const { match } = await checkIgnoreRule(
    relativePath,
    patternsOverride,
    false,
    workspaceRoot,
  );
  return match !== null;
}

/**
 * Throws if the given path is ignored by .spektaignore or by git
 * (unless whitelisted via a spekta negation pattern).
 *
 * @param displayPath - the already-resolved path to check against ignore
 *   rules (callers control root/".." handling before calling this).
 * @param targetPath - the original path used in the thrown error message.
 * @param verb - optional git-ignore message verb and index-independent
 *   Git ignore checking for operations that must enforce ignore rules on
 *   tracked paths. Defaults preserve existing caller behavior.
 */
export async function assertPathNotIgnored(
  displayPath: string,
  targetPath: string,
  verb: { git?: string; gitNoIndex?: boolean } = {},
  workspaceRoot?: string,
): Promise<void> {
  const { match } = await checkIgnoreRule(
    displayPath,
    undefined,
    verb.gitNoIndex,
    workspaceRoot,
  );

  if (match === "spekta") {
    throw new Error(
      `Access Denied: ${targetPath} is ignored by .spektaignore.`,
    );
  }

  if (match === "git") {
    const gitVerb = verb.git ?? "is";
    throw new Error(`Access Denied: ${targetPath} ${gitVerb} ignored by git.`);
  }
}
