import readline from "node:readline";
import path from "node:path";
import type { ResolvedWorkspace } from "../utils/workspace";
import { getGrepTokenLimit } from "../core/config";
import { getTokenCount } from "../utils/read-utils";
import { isPathIgnored } from "../utils/path-ignore";

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
  kill?: () => unknown;
}

interface ProcessErrorLike {
  exitCode?: number;
  message?: string;
}

export interface GrepOutputContext {
  workspace: ResolvedWorkspace;
  canonicalSearchPath: string;
  requestedSearchPath: string;
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
): Promise<string> {
  const resultsByFile: Record<string, string[]> = {};
  let totalMatches = 0;
  let totalTokens = 0;
  const MAX_GREP_TOKENS = getGrepTokenLimit();
  let truncated = false;
  const ignoreCache = new Map<string, boolean>();

  if (child.stdout) {
    const rl = readline.createInterface({
      input: child.stdout,
      terminal: false,
    });

    for await (const line of rl) {
      if (
        totalMatches >= MAX_MATCHES ||
        Object.keys(resultsByFile).length >= MAX_FILES ||
        totalTokens >= MAX_GREP_TOKENS
      ) {
        truncated = true;
        child.kill?.();
        break;
      }
      try {
        const parsed = JSON.parse(line) as unknown as GrepProcessMatchMessage;
        if (parsed?.type === "match" && parsed.data?.path?.text) {
          const filePath = parsed.data.path.text;

          let isIgnored = ignoreCache.get(filePath);
          if (isIgnored === undefined) {
            isIgnored = context
              ? await isPathIgnored(
                  filePath,
                  undefined,
                  context.workspace.canonicalRoot,
                )
              : await isPathIgnored(filePath);
            ignoreCache.set(filePath, isIgnored);
          }
          if (isIgnored) {
            continue;
          }

          const lineNum = parsed.data.line_number;
          const colNums = parsed.data.submatches
            .map((m: GrepProcessSubmatch) => m.start)
            .join(",");
          const text = parsed.data.lines.text.trimEnd();
          const formattedLine = `${lineNum}:${colNums}:${text}`;

          const displayPath = context
            ? displayGrepPath(filePath, context)
            : filePath;
          if (!resultsByFile[displayPath]) resultsByFile[displayPath] = [];
          resultsByFile[displayPath].push(formattedLine);
          totalMatches++;
          totalTokens += getTokenCount(formattedLine);
        }
      } catch {
        continue;
      }
    }
  }

  try {
    await child;
  } catch (error: unknown) {
    const procError = error as ProcessErrorLike;
    if (procError?.exitCode !== 1 && !truncated) {
      const message =
        error instanceof Error
          ? error.message
          : String(procError?.message ?? error);
      throw new Error(`Ripgrep error: ${message}`, { cause: error });
    }
  }

  if (Object.keys(resultsByFile).length === 0) {
    return "No matches found.";
  }

  let output = Object.entries(resultsByFile)
    .map(([file, matches]) => {
      const ext = file.split(".").pop();
      const lang = ext && ext !== file ? ext : "text";
      return `#### ${file}\n\`\`\`${lang}\n${matches.join("\n")}\n\`\`\``;
    })
    .join("\n\n");

  if (truncated) {
    output +=
      "\n\n**Notice:** Results truncated. Please use a more specific pattern or path.";
  }

  return output;
}
