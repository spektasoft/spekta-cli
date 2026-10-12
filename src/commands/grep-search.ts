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
  getGrepMinimumResponseTokens,
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
import { resolveRequestAllowance } from "../core/config/allowance";

function spawnRtkRg(args: string[], cwd: string, reject = true) {
  const env = { ...process.env };
  delete env.RG_CONFIG_PATH;
  delete env.RIPGREP_CONFIG_PATH;
  return execa("rtk", ["proxy", "rg", ...args], {
    cwd,
    env: { ...env, NO_COLOR: "1", TERM: "dumb" },
    detached: process.platform !== "win32",
    reject,
  });
}

export type { GrepOptions };
export { MAX_MATCHES };

export const MAX_ALLOWANCE_REJECTION_DIAGNOSTIC_TOKENS = 64;

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
  allowance?: unknown;
}

export async function getRgOutcome(
  request: SearchRequest,
  workspace?: WorkspaceContext,
  responseId?: string | number,
): Promise<OperationOutcome<string>> {
  const allowance = resolveRequestAllowance("search", request.allowance);
  if (allowance.status === "invalid") {
    return failureOutcome(
      "usage_error",
      "usage_error: Allowance must be a positive whole number.",
      responseId,
      undefined,
      true,
    );
  }
  if (allowance.status === "over_ceiling") {
    return failureOutcome(
      "output_limit_exceeded",
      `output_limit_exceeded: Allowance exceeds the configured ceiling of ${allowance.settings.ceilingTokens} tokens.`,
      responseId,
      undefined,
      true,
    );
  }
  const responseTokenLimit =
    allowance.requested ?? allowance.settings.defaultTokens;
  if (responseTokenLimit < getGrepMinimumResponseTokens(responseId)) {
    return failureOutcome(
      "output_limit_exceeded",
      "output_limit_exceeded: Allowance is too small for a response; use the configured default or a supported allowance within the ceiling.",
      responseId,
      undefined,
      true,
    );
  }

  if (
    request.patterns.length === 0 ||
    request.patterns.some((pattern) => !pattern.trim())
  ) {
    return failureOutcome(
      "usage_error",
      "usage_error: Search patterns cannot be empty or whitespace-only.",
      responseId,
    );
  }
  if (request.paths.includes("-")) {
    return failureOutcome(
      "usage_error",
      "usage_error: Standard input search paths are not supported.",
      responseId,
    );
  }

  return getGrepOutcome(
    {
      pattern: request.patterns[0],
      patterns: request.patterns,
      paths: request.paths.length ? request.paths : ["."],
      globs: request.globs,
      case_mode: request.case_mode,
      responseTokenLimit,
    },
    workspace,
    responseId,
  );
}

function failureOutcome(
  status: FailureOutcome["status"],
  message: string,
  responseId?: string | number,
  responseTokenLimit?: number,
  allowRejectedAllowanceEnvelopeException = false,
): OperationOutcome<string> {
  const configuredLimit = getGrepTokenLimit();
  if (
    !message.startsWith("usage_error:") &&
    !message.startsWith("unavailable_access:") &&
    !message.startsWith("internal_failure:") &&
    !message.startsWith("output_limit_exceeded:")
  ) {
    const label =
      status === "usage_error"
        ? "usage_error"
        : status === "policy_rejection"
          ? "unavailable_access"
          : status === "output_limit_exceeded"
            ? "output_limit_exceeded"
            : "internal_failure";
    message = `${label}: ${message}`;
  }

  if (getTokenCount(message) > MAX_ALLOWANCE_REJECTION_DIAGNOSTIC_TOKENS) {
    message =
      status === "policy_rejection"
        ? "unavailable_access: Search target is unavailable or not eligible."
        : status === "output_limit_exceeded"
          ? "output_limit_exceeded: All matches were withheld. Narrow the path or pattern."
          : status === "usage_error"
            ? "usage_error: Search request is invalid."
            : "internal_failure: Search engine failed.";
  }

  let limit = responseTokenLimit ?? configuredLimit;
  if (
    responseTokenLimit === undefined &&
    allowRejectedAllowanceEnvelopeException &&
    responseId !== undefined &&
    getGrepResponseTokenCount(message, responseId, true) > configuredLimit
  ) {
    const emptyEnvelopeTokens = getGrepResponseTokenCount("", responseId, true);
    const completeDiagnosticTokens = getGrepResponseTokenCount(
      message,
      responseId,
      true,
    );
    const measuredDiagnosticOverhead =
      completeDiagnosticTokens - emptyEnvelopeTokens;
    limit = Math.max(
      configuredLimit,
      emptyEnvelopeTokens + measuredDiagnosticOverhead,
    );
  }
  const fallback =
    status === "policy_rejection"
      ? "unavailable_access: Search target is unavailable or not eligible."
      : status === "output_limit_exceeded"
        ? "output_limit_exceeded: All matches were withheld. Narrow the path or pattern."
        : status === "usage_error"
          ? "usage_error: Search request is invalid."
          : "internal_failure: Search engine failed.";
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
        // Git ignore status and whitelist eligibility were both established
        // above, so repeating Git's per-path check here only adds serial work.
        { gitIgnoreAlreadyChecked: true },
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
  const { pattern, path: legacyPath = "." } = options;
  const responseTokenLimit = options.responseTokenLimit ?? getGrepTokenLimit();
  const requestedPaths = options.paths ?? [legacyPath];

  // SECURITY: Reject empty/whitespace patterns to prevent full-codebase scans
  const requestedPatterns =
    options.patterns ?? (pattern === undefined ? [] : [pattern]);
  if (
    requestedPatterns.length === 0 ||
    requestedPatterns.some((value) => !value || value.trim() === "")
  ) {
    return failureOutcome(
      "usage_error",
      "usage_error: Search pattern cannot be empty or whitespace-only.",
      responseId,
      responseTokenLimit,
    );
  }

  let resolvedWorkspace: ResolvedWorkspace;
  let canonicalSearchPaths: string[];
  try {
    resolvedWorkspace = await resolveWorkspace(workspace);
    canonicalSearchPaths = await Promise.all(
      requestedPaths.map((searchPath) =>
        validateReadPathAccess(searchPath, resolvedWorkspace),
      ),
    );
  } catch {
    return failureOutcome(
      "policy_rejection",
      "unavailable_access: Search target is unavailable or not eligible.",
      responseId,
      responseTokenLimit,
    );
  }

  try {
    if (!(await isRtkAvailable())) {
      return failureOutcome(
        "engine_failure",
        "internal_failure: Search engine is unavailable.",
        responseId,
        responseTokenLimit,
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
        "internal_failure: Search engine is unavailable.",
        responseId,
        responseTokenLimit,
      );
    }
  } catch {
    return failureOutcome(
      "engine_failure",
      "internal_failure: Search engine is unavailable.",
      responseId,
      responseTokenLimit,
    );
  }

  try {
    const args = await buildGrepArgs(
      { ...options, patterns: requestedPatterns, paths: canonicalSearchPaths },
      resolvedWorkspace.canonicalRoot,
    );
    const ignorePatterns = await getIgnorePatterns(
      resolvedWorkspace.canonicalRoot,
    );
    const additionalPaths = [
      ...new Set(
        (
          await Promise.all(
            canonicalSearchPaths.map((searchPath) =>
              findWhitelistedGitIgnoredFiles(
                options,
                searchPath,
                resolvedWorkspace,
                ignorePatterns,
              ),
            ),
          )
        ).flat(),
      ),
    ];
    if (additionalPaths.length > 0) {
      args.splice(args.length - 1, 0, ...additionalPaths);
    }
    const child = spawnRtkRg(args, resolvedWorkspace.canonicalRoot);

    return await parseGrepOutput(child, {
      workspace: resolvedWorkspace,
      canonicalSearchPath: canonicalSearchPaths[0],
      requestedSearchPath: requestedPaths[0] ?? ".",
      canonicalSearchPaths,
      requestedSearchPaths: requestedPaths,
      responseId,
      responseTokenLimit,
    });
  } catch {
    return failureOutcome(
      "engine_failure",
      "internal_failure: Search engine failed while preparing or running.",
      responseId,
      responseTokenLimit,
    );
  }
}

/** Compatibility renderer for existing internal string consumers. */
export async function getGrepContent(
  options: GrepOptions,
  workspace?: WorkspaceContext,
): Promise<string> {
  const outcome = await getGrepOutcome(options, workspace);
  if (outcome.status === "success" || outcome.status === "partial_result")
    return outcome.value;
  if (outcome.status === "engine_failure") throw new Error(outcome.message);
  return outcome.message;
}
