import { execa } from "execa";
import ignore from "ignore";
import path from "node:path";
import { getIgnorePatterns } from "../core/config";
import { isWhitelisted } from "./security";
import { isPathWithin, normalizeWorkspacePath } from "./workspace";

/**
 * Evaluates whether a relative or absolute target path is ignored
 * by spekta ignore configuration or gitignore rules.
 */
export type IgnoreRuleMatch = "spekta" | "git" | null;

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
  skipGitIgnoreCheck = false,
): Promise<IgnoreCheckResult> {
  const matcherPath = relativePath.split(path.sep).join("/");
  const spektaIgnores =
    patternsOverride ??
    (await (workspaceRoot === undefined
      ? getIgnorePatterns()
      : getIgnorePatterns(workspaceRoot)));

  const matches = await checkIgnoreRules(
    [matcherPath],
    spektaIgnores,
    gitNoIndex,
    workspaceRoot,
    skipGitIgnoreCheck,
  );
  return { match: matches.get(matcherPath) ?? null, spektaIgnores };
}

async function checkIgnoreRules(
  relativePaths: readonly string[],
  spektaIgnores: string[],
  gitNoIndex: boolean,
  workspaceRoot?: string,
  skipGitIgnoreCheck = false,
): Promise<Map<string, IgnoreRuleMatch>> {
  const matcherPaths = [
    ...new Set(
      relativePaths.map((relativePath) =>
        relativePath.split(path.sep).join("/"),
      ),
    ),
  ];
  const matches = new Map<string, IgnoreRuleMatch>(
    matcherPaths.map((matcherPath) => [matcherPath, null]),
  );
  const gitPaths: string[] = [];
  const spektaMatcher =
    spektaIgnores.length > 0 ? ignore().add(spektaIgnores) : undefined;

  for (const matcherPath of matcherPaths) {
    if (spektaMatcher?.ignores(matcherPath)) matches.set(matcherPath, "spekta");
    else if (!skipGitIgnoreCheck) gitPaths.push(matcherPath);
  }
  if (gitPaths.length === 0) return matches;

  let gitIgnored = new Set<string>();
  try {
    if (gitPaths.length === 1) {
      const args = [
        "check-ignore",
        "-q",
        ...(gitNoIndex ? ["--no-index"] : []),
        "--",
        gitPaths[0],
      ];
      if (workspaceRoot === undefined) await execa("git", args);
      else await execa("git", args, { cwd: workspaceRoot });
      gitIgnored = new Set(gitPaths);
    } else {
      const result = await execa(
        "git",
        [
          "check-ignore",
          "-z",
          ...(gitNoIndex ? ["--no-index"] : []),
          "--stdin",
        ],
        {
          ...(workspaceRoot === undefined ? {} : { cwd: workspaceRoot }),
          input: `${gitPaths.join("\0")}\0`,
          reject: false,
        },
      );
      if (result.exitCode === 0)
        gitIgnored = new Set(
          result.stdout.split("\0").filter((matcherPath) => matcherPath),
        );
    }
  } catch {
    // A failed Git check preserves the existing fail-open ignore-check behavior.
  }

  for (const matcherPath of gitIgnored) {
    if (!isWhitelisted(matcherPath, spektaIgnores))
      matches.set(matcherPath, "git");
  }
  return matches;
}

/** Resolve ignore matches for multiple relative paths with one Git check. */
export async function getIgnoreRuleMatches(
  relativePaths: readonly string[],
  gitNoIndex = false,
  workspaceRoot?: string,
): Promise<ReadonlyMap<string, IgnoreRuleMatch>> {
  const spektaIgnores = await getIgnorePatterns(workspaceRoot);
  return checkIgnoreRules(
    relativePaths,
    spektaIgnores,
    gitNoIndex,
    workspaceRoot,
  );
}

export async function isPathIgnored(
  targetPath: string,
  patternsOverride?: string[],
  workspaceRoot?: string,
): Promise<boolean> {
  const root = workspaceRoot ?? process.cwd();
  const normalizedPath = path.isAbsolute(targetPath)
    ? targetPath
    : normalizeWorkspacePath(targetPath);
  const absolutePath = path.resolve(root, normalizedPath);
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
  skipGitIgnoreCheck = false,
): Promise<void> {
  const { match } = await checkIgnoreRule(
    displayPath,
    undefined,
    verb.gitNoIndex,
    workspaceRoot,
    skipGitIgnoreCheck,
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
