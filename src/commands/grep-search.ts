import { execa } from "execa";
import fs from "fs-extra";
import path from "node:path";
import { getGrepTokenLimit, getIgnorePatterns } from "../core/config";
import { getTokenCount } from "../utils/read-utils";
import { isWhitelisted, validateReadPathAccess } from "../utils/security";
import {
  buildGrepArgs,
  buildGrepFileListArgs,
  GrepOptions,
} from "./grep-args-builder";
import {
  getGrepResponseTokenCount,
  parseGrepOutput,
  MAX_MATCHES,
} from "./grep-output-parser";
import {
  resolveWorkspace,
  type ResolvedWorkspace,
  type WorkspaceContext,
} from "../utils/workspace";
import { isRtkAvailable } from "./proxy/proxy-execution";
import {
  boundFailureOutcome,
  type FailureOutcome,
  type OperationOutcome,
} from "../core/operation-outcome";

function spawnRtkRg(args: string[], cwd: string, reject = true) {
  const env = { ...process.env };
  delete env.RG_CONFIG_PATH;
  delete env.RIPGREP_CONFIG_PATH;
  return execa("rtk", ["proxy", "rg", ...args], {
    cwd,
    env: { ...env, NO_COLOR: "1", TERM: "dumb" },
    reject,
  });
}

export type { GrepOptions };
export { MAX_MATCHES };

/** Stable transport-neutral request shape for the incremental `spekta rg` interface.
 * Arrays preserve repeated patterns, multiple paths and ordered globs without
 * flattening; case mode is an explicit native ripgrep choice.
 */
export type SearchCaseMode = "sensitive" | "insensitive" | "smart";
export interface SearchRequest {
  patterns: string[];
  paths: string[];
  globs: string[];
  case_mode: SearchCaseMode;
}

/** Current basic slice: exactly one pattern, zero or one path, no globs. */
export async function getRgOutcome(
  request: SearchRequest,
  workspace?: WorkspaceContext,
  responseId?: string | number,
): Promise<OperationOutcome<string>> {
  if (
    request.patterns.length !== 1 ||
    request.paths.length > 1 ||
    request.globs.length > 0
  ) {
    return failureOutcome(
      "policy_rejection",
      "This search interface currently supports one pattern, one path, and no globs.",
      responseId,
    );
  }
  return getGrepOutcome(
    {
      pattern: request.patterns[0],
      path: request.paths[0] ?? ".",
      case_insensitive:
        request.case_mode === "insensitive"
          ? true
          : request.case_mode === "sensitive"
            ? false
            : undefined,
    },
    workspace,
    responseId,
  );
}

function failureOutcome(
  status: FailureOutcome["status"],
  message: string,
  responseId?: string | number,
): OperationOutcome<string> {
  const configuredLimit = getGrepTokenLimit();
  const minimumEnvelope =
    responseId === undefined
      ? 0
      : getGrepResponseTokenCount("", responseId, true);
  const limit = Math.max(configuredLimit, minimumEnvelope);
  const fallback =
    status === "policy_rejection" ? "Search rejected." : "Search failed.";
  return boundFailureOutcome(status, message, fallback, limit, (candidate) =>
    Math.max(
      getGrepResponseTokenCount(candidate, responseId, true),
      getTokenCount(`[ERROR] ${candidate}\n`),
    ),
  );
}

async function findWhitelistedGitIgnoredFiles(
  options: GrepOptions,
  canonicalSearchPath: string,
  workspace: ResolvedWorkspace,
  spektaIgnorePatterns: string[],
): Promise<string[]> {
  if (!spektaIgnorePatterns.some((pattern) => pattern.startsWith("!"))) {
    return [];
  }

  if (!(await fs.stat(canonicalSearchPath)).isDirectory()) {
    return [];
  }

  const normalListArgs = await buildGrepFileListArgs(
    options,
    workspace.canonicalRoot,
    canonicalSearchPath,
    false,
  );
  const listFiles = async (args: string[]): Promise<string[]> => {
    try {
      const result = await spawnRtkRg(args, workspace.canonicalRoot, false);
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error("Ripgrep file listing failed.");
      }
      const stdout = result.stdout;
      return stdout.split("\0").filter(Boolean);
    } catch (error: unknown) {
      if ((error as { exitCode?: number }).exitCode === 1) return [];
      throw error;
    }
  };
  const normalFiles = await listFiles(normalListArgs);
  const normalFileSet = new Set(
    normalFiles.map((file) => path.resolve(workspace.canonicalRoot, file)),
  );

  const ignoredListArgs = await buildGrepFileListArgs(
    options,
    workspace.canonicalRoot,
    canonicalSearchPath,
  );
  const listing = await listFiles(ignoredListArgs);
  const candidates = [
    ...new Set(
      listing
        .map((candidate) => path.resolve(workspace.canonicalRoot, candidate))
        .filter((candidate) => !normalFileSet.has(candidate)),
    ),
  ];
  if (candidates.length === 0) return [];

  const relativeCandidates = candidates.map((candidate) =>
    path.relative(workspace.canonicalRoot, candidate),
  );
  let gitIgnored: Set<string>;
  try {
    // ripgrep applies Git ignore rules to tracked files too.
    const { stdout } = await execa(
      "git",
      ["check-ignore", "--no-index", "-z", "--stdin"],
      {
        cwd: workspace.canonicalRoot,
        input: `${relativeCandidates.join("\0")}\0`,
      },
    );
    gitIgnored = new Set(stdout.split("\0").filter(Boolean));
  } catch (error: unknown) {
    // A non-git workspace, or a git check with no ignored paths, adds no targets.
    if ([1, 128].includes((error as { exitCode?: number }).exitCode ?? -1)) {
      return [];
    }
    throw error;
  }

  const whitelisted: string[] = [];
  for (const [index, relativePath] of relativeCandidates.entries()) {
    if (
      !gitIgnored.has(relativePath) ||
      !isWhitelisted(relativePath, spektaIgnorePatterns)
    ) {
      continue;
    }
    try {
      const canonicalPath = await validateReadPathAccess(
        candidates[index],
        workspace,
      );
      whitelisted.push(canonicalPath);
    } catch {
      // Invalid, restricted, or otherwise denied candidates must not be searched.
    }
  }

  return [...new Set(whitelisted)];
}

export async function getGrepOutcome(
  options: GrepOptions,
  workspace?: WorkspaceContext,
  responseId?: string | number,
): Promise<OperationOutcome<string>> {
  const { pattern, path: searchPath = "." } = options;

  // SECURITY: Reject empty/whitespace patterns to prevent full-codebase scans
  if (!pattern || pattern.trim() === "") {
    return failureOutcome(
      "policy_rejection",
      "Search pattern cannot be empty or whitespace-only.",
      responseId,
    );
  }

  let resolvedWorkspace: ResolvedWorkspace;
  let canonicalSearchPath: string;
  try {
    resolvedWorkspace = await resolveWorkspace(workspace);
    canonicalSearchPath = await validateReadPathAccess(
      searchPath,
      resolvedWorkspace,
    );
  } catch {
    return failureOutcome(
      "policy_rejection",
      "Search rejected by workspace policy or the requested location is unavailable.",
      responseId,
    );
  }

  try {
    if (!(await isRtkAvailable())) {
      return failureOutcome(
        "engine_failure",
        "Search failed: RTK is unavailable.",
        responseId,
      );
    }
    const result = await spawnRtkRg(
      ["--version"],
      resolvedWorkspace.canonicalRoot,
      false,
    );
    if (result.exitCode !== 0) {
      return failureOutcome(
        "engine_failure",
        "Search failed: ripgrep is unavailable.",
        responseId,
      );
    }
  } catch {
    return failureOutcome(
      "engine_failure",
      "Search failed: ripgrep is unavailable.",
      responseId,
    );
  }

  try {
    const args = await buildGrepArgs(
      { ...options, path: canonicalSearchPath },
      resolvedWorkspace.canonicalRoot,
    );
    const ignorePatterns = await getIgnorePatterns(
      resolvedWorkspace.canonicalRoot,
    );
    const additionalPaths = await findWhitelistedGitIgnoredFiles(
      options,
      canonicalSearchPath,
      resolvedWorkspace,
      ignorePatterns,
    );
    if (additionalPaths.length > 0) {
      args.splice(args.length - 1, 0, ...additionalPaths);
    }
    const child = spawnRtkRg(args, resolvedWorkspace.canonicalRoot);

    return parseGrepOutput(child, {
      workspace: resolvedWorkspace,
      canonicalSearchPath,
      requestedSearchPath: searchPath,
      responseId,
    });
  } catch {
    return failureOutcome(
      "engine_failure",
      "Search failed while preparing or running the search engine.",
      responseId,
    );
  }
}

/** Compatibility renderer for existing internal string consumers. */
export async function getGrepContent(
  options: GrepOptions,
  workspace?: WorkspaceContext,
): Promise<string> {
  const outcome = await getGrepOutcome(options, workspace);
  if (outcome.status === "success") return outcome.value;
  if (outcome.status === "engine_failure") throw new Error(outcome.message);
  return outcome.message;
}
