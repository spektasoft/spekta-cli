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
  getGrepResponseByteCount,
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
import {
  admitBatchMetadata,
  type BatchOperandOutcome,
} from "../core/batch-planning";
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
export const MAX_SEARCH_PROGRESS_EVENTS = 4;

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
  profile?: boolean;
  /** Called with fixed, non-sensitive lifecycle phase labels. */
  onProgress?: (phase: "preparing" | "searching") => void;
  onTimings?: (timings: { preparationMs: number; executionMs: number }) => void;
  progressAllowanceTokens?: number;
}

export interface SearchLifecycle {
  onProgress?: (phase: "preparing" | "searching") => void;
  setPhase(phase: "preparing" | "searching"): void;
  finish(): { preparationMs: number; executionMs: number };
}

export function resolveSearchTelemetryBudget(
  responseTokenLimit: number,
  minimumResponseTokens: number,
  progressRequested: boolean,
  progressAllowanceTokens: number,
  profileRequested: boolean,
) {
  const maxProgressReserve = Math.min(256, Math.floor(responseTokenLimit / 4));
  const progressEnabled =
    progressRequested &&
    progressAllowanceTokens > 0 &&
    progressAllowanceTokens <= maxProgressReserve &&
    responseTokenLimit >= minimumResponseTokens + progressAllowanceTokens;
  const profileEnabled =
    profileRequested &&
    responseTokenLimit >=
      minimumResponseTokens +
        (progressEnabled ? progressAllowanceTokens : 0) +
        32;
  return {
    progressEnabled,
    profileEnabled,
    reservedTokens:
      (progressEnabled ? progressAllowanceTokens : 0) +
      (profileEnabled ? 32 : 0),
  };
}

export function createSearchLifecycle(
  onProgress?: SearchLifecycle["onProgress"],
  clock: () => number = Date.now,
  schedule: typeof setTimeout = setTimeout,
  cancel: typeof clearTimeout = clearTimeout,
): SearchLifecycle {
  const started = clock();
  let phase: "preparing" | "searching" = "preparing";
  let preparationEnd: number | undefined;
  let executionStart: number | undefined;
  let emitted = false;
  let sent = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  const publish = () => {
    if (stopped || !onProgress || sent >= MAX_SEARCH_PROGRESS_EVENTS) return;
    try {
      onProgress(phase);
      emitted = true;
      sent++;
    } catch {
      /* telemetry is best effort */
    }
  };
  if (onProgress)
    timer = schedule(() => {
      publish();
      const pulse = () => {
        if (stopped || sent >= MAX_SEARCH_PROGRESS_EVENTS) return;
        publish();
        heartbeat = schedule(pulse, 5000);
      };
      heartbeat = schedule(pulse, 5000);
    }, 2000);
  return {
    onProgress,
    setPhase(next) {
      if (next === phase) return;
      const now = clock();
      if (next === "searching") {
        preparationEnd = now;
        executionStart = now;
      }
      phase = next;
      if (emitted) publish();
    },
    finish() {
      stopped = true;
      if (timer) cancel(timer);
      if (heartbeat) cancel(heartbeat);
      const now = clock();
      const boundary = preparationEnd ?? now;
      return {
        preparationMs: Math.max(0, boundary - started),
        executionMs: Math.max(0, now - (executionStart ?? now)),
      };
    },
  };
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

  const budget = resolveSearchTelemetryBudget(
    responseTokenLimit,
    getGrepMinimumResponseTokens(responseId),
    Boolean(request.onProgress),
    request.progressAllowanceTokens ?? 0,
    Boolean(request.profile),
  );
  const profile = budget.profileEnabled;
  let timings: { preparationMs: number; executionMs: number } | undefined;
  const outcome = await getGrepOutcome(
    {
      pattern: request.patterns[0],
      patterns: request.patterns,
      paths: request.paths.length ? request.paths : ["."],
      globs: request.globs,
      case_mode: request.case_mode,
      responseTokenLimit: responseTokenLimit - budget.reservedTokens,
      onProgress: budget.progressEnabled ? request.onProgress : undefined,
      profile,
      onTimings: (value) => {
        timings = value;
      },
    },
    workspace,
    responseId,
  );
  if (
    profile &&
    timings &&
    (outcome.status === "success" || outcome.status === "no_matches")
  ) {
    const line = `\nTimings: preparation ${timings.preparationMs} ms; search ${timings.executionMs} ms.`;
    const text =
      outcome.status === "success"
        ? outcome.value + line
        : outcome.message + line;
    if (getGrepResponseTokenCount(text, responseId) <= responseTokenLimit) {
      request.onTimings?.(timings);
      return outcome.status === "success"
        ? { ...outcome, value: text }
        : { ...outcome, message: text };
    }
  }
  return outcome;
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
  const lifecycle = createSearchLifecycle(options.onProgress);
  try {
    return await getGrepOutcomeInternal(
      { ...options, setSearchPhase: () => lifecycle.setPhase("searching") },
      workspace,
      responseId,
    );
  } finally {
    const timings = lifecycle.finish();
    if (options.profile) options.onTimings?.(timings);
  }
}

async function getGrepOutcomeInternal(
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
  const operandOutcomes: BatchOperandOutcome[] = [];
  const admittedPaths: string[] = [];
  const admittedRequestedPaths: string[] = [];
  try {
    resolvedWorkspace = await resolveWorkspace(workspace);
  } catch {
    return failureOutcome(
      "policy_rejection",
      "unavailable_access: Search target is unavailable or not eligible.",
      responseId,
      responseTokenLimit,
    );
  }

  const uniquePaths = new Map<string, string>();
  for (const [index, searchPath] of requestedPaths.entries()) {
    try {
      const canonical = await validateReadPathAccess(
        searchPath,
        resolvedWorkspace,
      );
      operandOutcomes.push({ position: index + 1, status: "returned" });
      if (!uniquePaths.has(canonical)) uniquePaths.set(canonical, searchPath);
    } catch {
      operandOutcomes.push({ position: index + 1, status: "unavailable" });
    }
  }
  const unavailable = operandOutcomes.some(
    (item) => item.status === "unavailable",
  );
  const availableCount = operandOutcomes.filter(
    (item) => item.status === "returned",
  ).length;
  const operandRows = (availableLabel: string) =>
    operandOutcomes
      .map((item) =>
        item.status === "unavailable"
          ? `Operand ${item.position}: unavailable; unavailable_access\n`
          : `Operand ${item.position}: ${availableLabel}\n`,
      )
      .join("");
  const batchStatus = unavailable ? "Batch: partial_result\n" : "";
  const scopeText =
    batchStatus +
    `Scope: ${availableCount}/${requestedPaths.length} roots searched.\n` +
    (unavailable
      ? "Recovery: Retry unavailable roots when access is available.\n"
      : "") +
    operandRows("searched");
  const withheldText =
    `output_limit_exceeded: All matches withheld; search cancelled.\n` +
    (unavailable ? "Batch: partial_result\n" : "") +
    `Scope: ${availableCount}/${requestedPaths.length} roots admitted; search incomplete, matches withheld.\n` +
    (unavailable
      ? "Requested scope is incomplete; some roots were unavailable.\n"
      : "") +
    (unavailable
      ? "Recovery: Retry unavailable; narrow path/pattern.\n"
      : "Recovery: Narrow path/pattern.\n") +
    operandOutcomes
      .map((item) =>
        item.status === "unavailable"
          ? `Operand ${item.position}: unavailable; unavailable_access\n`
          : `Operand ${item.position}: incomplete; matches withheld\n`,
      )
      .join("");
  const engineFailureText =
    `internal_failure: Search failed.\n` +
    (unavailable ? "Batch: partial_result\n" : "") +
    `Scope: ${availableCount}/${requestedPaths.length}; incomplete.\n` +
    (unavailable
      ? "Recovery: Retry unavailable roots; retry search.\n"
      : "Recovery: Retry search.\n") +
    operandRows("search incomplete; internal_failure");
  const overflowOperands = operandOutcomes.map((item) => ({
    ...item,
    ...(item.status === "returned" ? { status: "incomplete" as const } : {}),
  }));
  const overflowOutcome = (): OperationOutcome<string> => ({
    status: "output_limit_exceeded",
    message: withheldText,
    operands: overflowOperands,
  });
  const allUnavailableText =
    `unavailable_access: Search targets are unavailable or not eligible.\n` +
    `Batch: partial_result\nScope: 0/${requestedPaths.length} eligible roots.\n` +
    "Recovery: Retry unavailable roots.\n" +
    operandRows("unavailable; unavailable_access");
  const rejectMetadata = () =>
    failureOutcome(
      "output_limit_exceeded",
      "output_limit_exceeded: Search scope metadata exceeds the response budget. Reduce the number of roots or increase the allowance.",
      responseId,
      responseTokenLimit,
    );
  const reservationCandidates = [
    {
      text: `${scopeText}success: Search completed with matches.\n`,
      error: unavailable,
      cliError: false,
    },
    {
      text: `${scopeText}no_matches: No matches found.`,
      error: unavailable,
      cliError: false,
    },
    { text: withheldText, error: true, cliError: true },
    { text: engineFailureText, error: true, cliError: !unavailable },
    ...(availableCount === 0
      ? [{ text: allUnavailableText, error: true, cliError: true }]
      : []),
  ];
  const metadataBytes = Math.max(
    ...reservationCandidates.map(({ text, error, cliError }) =>
      Math.max(
        getGrepResponseByteCount(text, responseId, error),
        cliError ? Buffer.byteLength(`[ERROR] ${text}\n`, "utf8") : 0,
      ),
    ),
  );
  const metadataTokens = Math.max(
    ...reservationCandidates.map(({ text, error, cliError }) =>
      Math.max(
        getGrepResponseTokenCount(text, responseId, error),
        cliError ? getTokenCount(`[ERROR] ${text}\n`) : 0,
      ),
    ),
  );
  if (
    metadataTokens > responseTokenLimit ||
    !admitBatchMetadata(metadataBytes, responseTokenLimit)
  )
    return rejectMetadata();
  if (uniquePaths.size === 0) {
    return {
      status: "policy_rejection",
      message: allUnavailableText,
      operands: operandOutcomes,
    };
  }
  const engineFailureOutcome = (): OperationOutcome<string> =>
    unavailable
      ? {
          status: "partial_result",
          value: engineFailureText,
          operands: operandOutcomes.map((item) => ({
            ...item,
            ...(item.status === "returned"
              ? { status: "internal_failure" as const }
              : {}),
          })),
        }
      : { status: "engine_failure", message: engineFailureText };
  for (const [canonical, requested] of uniquePaths) {
    admittedPaths.push(canonical);
    admittedRequestedPaths.push(requested);
  }
  const canonicalSearchPaths = admittedPaths;

  try {
    if (!(await isRtkAvailable())) {
      return engineFailureOutcome();
    }
    const result = await spawnRtkRg(
      ["--version"],
      resolvedWorkspace.canonicalRoot,
      false,
    );
    if (result.exitCode !== 0) {
      return engineFailureOutcome();
    }
  } catch {
    return engineFailureOutcome();
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
    options.setSearchPhase?.();

    const search: OperationOutcome<string> = await parseGrepOutput(child, {
      workspace: resolvedWorkspace,
      canonicalSearchPath: canonicalSearchPaths[0],
      requestedSearchPath: admittedRequestedPaths[0] ?? ".",
      canonicalSearchPaths,
      requestedSearchPaths: admittedRequestedPaths,
      responseId,
      responseTokenLimit,
      responsePrefix: scopeText,
      responseIsError: unavailable,
    });
    if (search.status === "output_limit_exceeded") return overflowOutcome();
    if (search.status === "engine_failure") return engineFailureOutcome();
    const body = String(
      search.status === "success" ? search.value : search.message,
    );
    const value = `${scopeText}${body}`;
    if (
      getGrepResponseTokenCount(value, responseId, unavailable) >
      responseTokenLimit
    )
      return overflowOutcome();
    if (unavailable)
      return { status: "partial_result", value, operands: operandOutcomes };
    return search.status === "no_matches"
      ? { status: "no_matches", message: value }
      : { status: "success", value };
  } catch {
    return engineFailureOutcome();
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
