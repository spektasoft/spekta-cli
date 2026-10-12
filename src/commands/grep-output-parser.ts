import readline from "node:readline";
import path from "node:path";
import type { ResolvedWorkspace } from "../utils/workspace";
import { getGrepTokenLimit } from "../core/config";
import { getTokenCount } from "../utils/read-utils";
import { isPathIgnored } from "../utils/path-ignore";
import { validateReadPathAccess } from "../utils/security";
import type { OperationOutcome } from "../core/operation-outcome";

export const MAX_MATCHES = 500;
const MAX_FILES = 100;

export interface GrepProcessSubmatch {
  start: number;
}

export interface GrepProcessMatchData {
  path: { text: string };
  line_number: number;
  submatches: GrepProcessSubmatch[];
  lines: { text: string };
}

export interface GrepProcessMatchMessage {
  type: string;
  data: GrepProcessMatchData;
}

export interface GrepChildProcess extends PromiseLike<unknown> {
  stdout?: NodeJS.ReadableStream | null;
  pid?: number;
  kill?: () => unknown;
}

interface ProcessErrorLike {
  exitCode?: number | null;
  signal?: string | null;
  message?: string;
}

export interface GrepOutputContext {
  workspace: ResolvedWorkspace;
  canonicalSearchPath: string;
  requestedSearchPath: string;
  canonicalSearchPaths?: string[];
  requestedSearchPaths?: string[];
  responseId?: string | number;
  responseTokenLimit?: number;
  /** Text rendered before this search result in the complete response. */
  responsePrefix?: string;
  responseIsError?: boolean;
}

const OUTPUT_LIMIT_GUIDANCE =
  "output_limit_exceeded: All matches were withheld. Narrow with a symbol or pattern (`-e 'class Name'`), a path (`src/module/file.ts`), or a glob (`-g '*.ts'`).";

export function getGrepMinimumResponseTokens(
  responseId?: string | number,
): number {
  const failureTokens = (message: string) =>
    Math.max(
      getGrepResponseTokenCount(message, responseId, true),
      getTokenCount(`[ERROR] ${message}\n`),
    );
  return Math.max(
    failureTokens(OUTPUT_LIMIT_GUIDANCE),
    getGrepResponseTokenCount("no_matches: No matches found.", responseId),
    failureTokens("internal_failure: Search engine failed."),
    failureTokens("usage_error: Search request is invalid."),
    failureTokens("unavailable_access: Search target is unavailable."),
  );
}

/** Count the CLI line and, when an MCP request ID is known, its full response. */
export function getGrepResponseTokenCount(
  text: string,
  responseId?: string | number,
  isError = false,
): number {
  const cliTokens = getTokenCount(`${text}\n`);
  if (responseId === undefined) return cliTokens;
  const mcpResponse = JSON.stringify({
    result: {
      content: [{ type: "text", text }],
      ...(isError ? { isError: true } : {}),
    },
    jsonrpc: "2.0",
    id: responseId,
  });
  return Math.max(cliTokens, getTokenCount(`${mcpResponse}\n`));
}

/** Conservative UTF-8 bound for the complete CLI or MCP response. */
export function getGrepResponseByteCount(
  text: string,
  responseId?: string | number,
  isError = false,
): number {
  const cliBytes = Buffer.byteLength(`${text}\n`, "utf8");
  if (responseId === undefined) return cliBytes;
  const mcpResponse = JSON.stringify({
    result: {
      content: [{ type: "text", text }],
      ...(isError ? { isError: true } : {}),
    },
    jsonrpc: "2.0",
    id: responseId,
  });
  return Math.max(cliBytes, Buffer.byteLength(`${mcpResponse}\n`, "utf8"));
}

function boundedMessage(
  message: string,
  tokenLimit: number,
  responseId?: string | number,
  responsePrefix = "",
  responsePrefixIsError = false,
): string {
  const isFailure =
    responsePrefixIsError ||
    /^(?:internal_failure|usage_error|unavailable_access|output_limit_exceeded):/.test(
      message,
    );
  if (
    getGrepResponseTokenCount(
      `${responsePrefix}${message}`,
      responseId,
      isFailure,
    ) <= tokenLimit &&
    (!isFailure ||
      getTokenCount(`[ERROR] ${responsePrefix}${message}\n`) <= tokenLimit)
  ) {
    return message;
  }
  const shortMessages = isFailure
    ? [
        "internal_failure: Search engine failed.",
        "internal_failure: Failed.",
        "",
      ]
    : ["no_matches: No matches found.", "no_matches: No matches.", ""];
  return (
    shortMessages.find(
      (candidate) =>
        getGrepResponseTokenCount(
          `${responsePrefix}${candidate}`,
          responseId,
          isFailure,
        ) <= tokenLimit &&
        (!isFailure ||
          getTokenCount(`[ERROR] ${responsePrefix}${candidate}\n`) <=
            tokenLimit),
    ) ?? ""
  );
}

function displayGrepPath(filePath: string, context: GrepOutputContext): string {
  const absolutePath = path.resolve(context.workspace.canonicalRoot, filePath);
  const relative = path.relative(context.canonicalSearchPath, absolutePath);
  const requested = context.requestedSearchPath;
  if (relative === "") return requested;
  if (requested === ".") return `.${path.sep}${relative}`;
  const joined = path.join(requested, relative);
  return requested.startsWith(`.${path.sep}`) && !path.isAbsolute(joined)
    ? `.${path.sep}${joined}`
    : joined;
}

export async function parseGrepOutput(
  child: GrepChildProcess,
  context?: GrepOutputContext,
): Promise<OperationOutcome<string>> {
  // Attach a rejection handler before consuming stdout so a fast failing child
  // cannot surface an unhandled rejection while buffered lines are parsed.
  const childCompletion = Promise.resolve(child).then(
    () => ({}),
    (error: unknown) => ({ error }),
  );
  const resultsByFile: Record<string, string[]> = {};
  let totalMatches = 0;
  const MAX_GREP_TOKENS = context?.responseTokenLimit ?? getGrepTokenLimit();
  const responsePrefix = context?.responsePrefix ?? "";
  const responsePrefixIsError = context?.responseIsError ?? false;
  const responseCount = (text: string, isError = responsePrefixIsError) =>
    getGrepResponseTokenCount(
      `${responsePrefix}${text}`,
      context?.responseId,
      isError,
    );
  let exceeded = false;
  let cancellationRequested = false;
  const eligibilityCache = new Map<string, string | null>();
  const seenMatches = new Set<string>();
  const stopForLimit = () => {
    exceeded = true;
    cancellationRequested = true;
    if (child.pid && process.platform !== "win32") {
      try {
        // RTK may launch ripgrep as a descendant. The detached process group
        // lets a response-budget cancellation stop both processes together.
        process.kill(-child.pid, "SIGTERM");
        return;
      } catch {
        // Fall through to the direct child handle if the group has exited.
      }
    }
    child.kill?.();
  };

  if (child.stdout) {
    const rl = readline.createInterface({
      input: child.stdout,
      terminal: false,
    });

    for await (const line of rl) {
      try {
        const parsed = JSON.parse(line) as unknown as GrepProcessMatchMessage;
        if (parsed?.type === "match" && parsed.data?.path?.text) {
          const filePath = parsed.data.path.text;

          let eligiblePath = eligibilityCache.get(filePath);
          if (eligiblePath === undefined) {
            try {
              if (context) {
                eligiblePath = await validateReadPathAccess(
                  filePath,
                  context.workspace,
                );
                const searchPaths = context.canonicalSearchPaths ?? [
                  context.canonicalSearchPath,
                ];
                const requestedPaths = context.requestedSearchPaths ?? [
                  context.requestedSearchPath,
                ];
                let matchedRequestedPath = false;
                for (const [index, searchPath] of searchPaths.entries()) {
                  const relativeToSearch = path.relative(
                    searchPath,
                    eligiblePath,
                  );
                  if (
                    relativeToSearch.startsWith("..") ||
                    path.isAbsolute(relativeToSearch)
                  )
                    continue;
                  const requestedMatchPath = path.resolve(
                    context.workspace.root,
                    requestedPaths[index] ?? ".",
                    relativeToSearch,
                  );
                  try {
                    const requestedEligiblePath = await validateReadPathAccess(
                      requestedMatchPath,
                      context.workspace,
                    );
                    if (requestedEligiblePath === eligiblePath)
                      matchedRequestedPath = true;
                  } catch {
                    /* another requested path may authorize this match */
                  }
                }
                if (!matchedRequestedPath) eligiblePath = null;
              } else {
                eligiblePath = (await isPathIgnored(filePath))
                  ? null
                  : filePath;
              }
            } catch {
              // Search may encounter denied descendants beneath an allowed
              // root. Their names and contents must not reach the response.
              eligiblePath = null;
            }
            eligibilityCache.set(filePath, eligiblePath);
          }
          if (eligiblePath === null) continue;

          const lineNum = parsed.data.line_number;
          const colNums = parsed.data.submatches
            .map((m: GrepProcessSubmatch) => m.start)
            .join(",");
          const text = parsed.data.lines.text.trimEnd();
          const identity = `${eligiblePath}\0${lineNum}\0${colNums}\0${text}`;
          if (seenMatches.has(identity)) continue;
          seenMatches.add(identity);
          const formattedLine = `${lineNum}:${colNums}:${text}`;

          const displayPath = context
            ? context.canonicalSearchPaths &&
              context.canonicalSearchPaths.length > 1
              ? path.relative(context.workspace.canonicalRoot, eligiblePath)
              : displayGrepPath(
                  path.relative(context.workspace.canonicalRoot, eligiblePath),
                  context,
                )
            : filePath;
          if (
            totalMatches >= MAX_MATCHES ||
            (!resultsByFile[displayPath] &&
              Object.keys(resultsByFile).length >= MAX_FILES)
          ) {
            stopForLimit();
            break;
          }
          if (!resultsByFile[displayPath]) resultsByFile[displayPath] = [];
          resultsByFile[displayPath].push(formattedLine);
          totalMatches++;
          const candidate = formatResults(resultsByFile);
          if (
            responseCount(
              `success: Search completed with matches.\n${candidate}`,
            ) > MAX_GREP_TOKENS
          ) {
            resultsByFile[displayPath].pop();
            if (resultsByFile[displayPath].length === 0)
              delete resultsByFile[displayPath];
            totalMatches--;
            stopForLimit();
            break;
          }
        }
      } catch {
        continue;
      }
    }
  }

  const completion = await childCompletion;
  if ("error" in completion) {
    const error = completion.error;
    const procError = error as ProcessErrorLike;
    const expectedCancellation =
      cancellationRequested &&
      procError?.exitCode == null &&
      procError.signal === "SIGTERM";
    if (procError?.exitCode !== 1 && !expectedCancellation) {
      // Execa's message may embed buffered stdout, including matches that this
      // parser deliberately withheld. Report only process metadata.
      const failureDetail =
        typeof procError?.exitCode === "number"
          ? `exit code ${procError.exitCode}`
          : procError?.signal
            ? `signal ${procError.signal}`
            : "unknown process error";
      return {
        status: "engine_failure",
        message: boundedMessage(
          `internal_failure: Search process failed (${failureDetail}).`,
          MAX_GREP_TOKENS,
          context?.responseId,
          responsePrefix,
          responsePrefixIsError,
        ),
      };
    }
  }

  if (Object.keys(resultsByFile).length === 0) {
    return exceeded
      ? {
          status: "output_limit_exceeded",
          message: getOutputLimitGuidance(
            MAX_GREP_TOKENS,
            context?.responseId,
            responsePrefix,
          ),
        }
      : {
          status: "no_matches",
          message: boundedMessage(
            "no_matches: No matches found.",
            MAX_GREP_TOKENS,
            context?.responseId,
            responsePrefix,
            responsePrefixIsError,
          ),
        };
  }

  if (exceeded)
    return {
      status: "output_limit_exceeded",
      message: getOutputLimitGuidance(
        MAX_GREP_TOKENS,
        context?.responseId,
        responsePrefix,
      ),
    };
  const formatted = `success: Search completed with matches.\n${formatResults(resultsByFile)}`;
  if (responseCount(formatted) > MAX_GREP_TOKENS) {
    return {
      status: "output_limit_exceeded",
      message: getOutputLimitGuidance(
        MAX_GREP_TOKENS,
        context?.responseId,
        responsePrefix,
      ),
    };
  }
  return { status: "success", value: formatted };
}

function getOutputLimitGuidance(
  tokenLimit: number,
  responseId?: string | number,
  responsePrefix = "",
): string {
  const candidates = [
    OUTPUT_LIMIT_GUIDANCE,
    "Search too broad; matches withheld. Narrow by symbol, path, pattern, or glob.",
    "Search too broad; all matches withheld. Narrow the symbol, path, pattern, or glob.",
    "Matches withheld; narrow the path or pattern.",
    "Withheld; narrow.",
    "Withheld; narrow path.",
    "Withheld.",
    "",
  ];
  return (
    candidates.find(
      (message) =>
        Math.max(
          getGrepResponseTokenCount(
            `${responsePrefix}${message}`,
            responseId,
            true,
          ),
          getTokenCount(`[ERROR] ${message}\n`),
        ) <= tokenLimit,
    ) ?? ""
  );
}

function formatResults(resultsByFile: Record<string, string[]>): string {
  return Object.entries(resultsByFile)
    .map(([file, matches]) => {
      const ext = file.split(".").pop();
      const lang = ext && ext !== file ? ext : "text";
      return `#### ${file}\n\`\`\`${lang}\n${matches.join("\n")}\n\`\`\``;
    })
    .join("\n\n");
}
