import fs from "fs-extra";
import path from "path";
import { isPathWithin, type WorkspaceContext } from "../../utils/workspace";

/**
 * Filesystem backends for workspace listing and discovery.
 *
 * Linux and WSL keep the RTK and GNU Findutils backends; Windows enumerates
 * the filesystem directly through Node, because GNU find and the RTK Unix
 * pipeline must not be required natively. The override pin below keeps the
 * RTK backend reachable on Windows so its own verification suites can still
 * exercise it; POSIX hosts always retain RTK/GNU enumeration.
 *
 * Native backends reproduce the raw output contract of the tools they
 * replace: one `ls` name per line (LC_ALL=C code point order), and GNU find
 * `./relative` physical traversal lines with `/` separators, both consumed
 * unchanged by the existing batch disclosure layers.
 */

const BACKEND_OVERRIDE_ENV = "SPEKTA_LISTING_BACKEND_OVERRIDE";

export type ListingBackend = "native" | "rtk";

export function resolveListingBackend(): ListingBackend {
  if (process.platform === "win32") {
    return process.env[BACKEND_OVERRIDE_ENV] === "rtk" ? "rtk" : "native";
  }
  // POSIX keeps the documented RTK/GNU backend regardless of the override.
  return "rtk";
}

export interface InlineCommandResult {
  stdout: string;
  exitCode: number;
}

export function workspaceDirectory(context?: WorkspaceContext): string {
  return path.resolve(context?.root ?? process.cwd());
}

/** Code point order, matching `ls -1Ab` under LC_ALL=C (UTF-8 byte order). */
function compareName(left: string, right: string): number {
  if (left === right) return 0;
  const leftChars = Array.from(left);
  const rightChars = Array.from(right);
  const shared = Math.min(leftChars.length, rightChars.length);
  for (let index = 0; index < shared; index++) {
    const leftCode = leftChars[index]?.codePointAt(0) ?? 0;
    const rightCode = rightChars[index]?.codePointAt(0) ?? 0;
    if (leftCode !== rightCode) return leftCode < rightCode ? -1 : 1;
  }
  return leftChars.length === rightChars.length
    ? 0
    : leftChars.length < rightChars.length
      ? -1
      : 1;
}

/** List one workspace directory as one plain name per line. */
export async function runNativeLsListing(
  operand: string,
  context?: WorkspaceContext,
): Promise<InlineCommandResult> {
  try {
    const names = await fs.readdir(
      path.resolve(workspaceDirectory(context), operand),
    );
    names.sort(compareName);
    return {
      stdout: names.map((name) => `${name}\n`).join(""),
      exitCode: 0,
    };
  } catch {
    return { stdout: "", exitCode: 1 };
  }
}

type EntryType = "f" | "d" | "l";

interface NativePredicates {
  type?: "f" | "d";
  name?: (name: string) => boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * POSIX fnmatch subset for find -name: `*`, `?`, ranges/sets in `[...]` with
 * `!`/`^` negation, and backslash escaping, without pathname or period
 * semantics (basenames only, leading dots match wildcards like GNU find).
 */
function compileNamePattern(pattern: string): (name: string) => boolean {
  let regex = "";
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index];
    if (char === "*") {
      regex += "[\\s\\S]*";
      index += 1;
    } else if (char === "?") {
      regex += "[\\s\\S]";
      index += 1;
    } else if (char === "\\") {
      const escaped = pattern[index + 1];
      if (escaped === undefined) {
        regex += "\\\\";
        index += 1;
      } else {
        regex += escapeRegExp(escaped);
        index += 2;
      }
    } else if (char === "[") {
      let cursor = index + 1;
      let negated = false;
      if (pattern[cursor] === "!" || pattern[cursor] === "^") {
        negated = true;
        cursor += 1;
      }
      let body = "";
      let closed = false;
      // A `]` at the start of the set (after any negation) is literal.
      if (pattern[cursor] === "]") {
        body += "\\]";
        cursor += 1;
      }
      while (cursor < pattern.length && pattern[cursor] !== "]") {
        const current = pattern[cursor];
        if (current === "\\" && pattern[cursor + 1] !== undefined) {
          body += escapeRegExp(pattern[cursor + 1]);
          cursor += 2;
          continue;
        }
        const next = pattern[cursor + 1];
        if (next === "-" && pattern[cursor + 2] !== undefined) {
          const bound = pattern[cursor + 2];
          // Endpoints are re-ordered so reversed ranges stay expressible;
          // POSIX leaves reversed ranges undefined.
          const lower = current.codePointAt(0) < bound.codePointAt(0)
            ? current
            : bound;
          const upper = lower === current ? bound : current;
          body += escapeRegExp(lower) + "-" + escapeRegExp(upper);
          cursor += 3;
          continue;
        }
        body += escapeRegExp(current);
        cursor += 1;
      }
      if (cursor < pattern.length) closed = true;
      if (closed) {
        regex += `[${negated ? "^" : ""}${body}]`;
        index = cursor + 1;
      } else {
        regex += escapeRegExp("[");
        index += 1;
      }
    } else {
      regex += escapeRegExp(char);
      index += 1;
    }
  }
  const matcher = new RegExp(`^${regex}$`);
  return (name) => matcher.test(name);
}

function parseNativePredicates(
  predicateArgs: readonly string[],
): NativePredicates | null {
  const predicates: NativePredicates = {};
  let index = 0;
  while (index < predicateArgs.length) {
    const token = predicateArgs[index];
    if (token === "-type") {
      if (predicates.type !== undefined) return null;
      const value = predicateArgs[index + 1];
      if (value !== "f" && value !== "d") return null;
      predicates.type = value;
      index += 2;
    } else if (token === "-name") {
      if (predicates.name !== undefined) return null;
      const pattern = predicateArgs[index + 1];
      if (pattern === undefined) return null;
      predicates.name = compileNamePattern(pattern);
      index += 2;
    } else if (token === "-print") {
      // Implicit printing is already the native walk's output contract.
      index += 1;
    } else {
      return null;
    }
  }
  return predicates;
}

interface ClassifiableEntry {
  isFile(): boolean;
  isDirectory(): boolean;
}

function entryType(entry: ClassifiableEntry): EntryType {
  if (entry.isFile()) return "f";
  if (entry.isDirectory()) return "d";
  // Symlinks and junctions are links; they are matched but never traversed.
  return "l";
}

function matchesEntry(
  type: EntryType,
  name: string,
  predicates: NativePredicates,
): boolean {
  if (predicates.type !== undefined && predicates.type !== type) return false;
  return predicates.name === undefined || predicates.name(name);
}

interface FindWalk {
  lines: string[];
  failed: boolean;
}

/**
 * GNU find `-P` physical traversal: the start point is classified with
 * `lstat`, directory links are never followed, and every entry is printed in
 * filesystem encounter order (find does not sort).
 */
async function startFindWalk(
  startDirectory: string,
  displayRoot: string,
  predicates: NativePredicates,
): Promise<FindWalk> {
  const walk: FindWalk = { lines: [], failed: false };
  let stat;
  try {
    stat = await fs.lstat(startDirectory);
  } catch {
    walk.failed = true;
    return walk;
  }
  const rootType = entryType(stat);
  if (matchesEntry(rootType, displayRoot, predicates))
    walk.lines.push(displayRoot);
  if (rootType === "d")
    await walkDirectory(walk, startDirectory, displayRoot, predicates);
  return walk;
}

async function walkDirectory(
  walk: FindWalk,
  directory: string,
  display: string,
  predicates: NativePredicates,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    walk.failed = true;
    return;
  }
  for (const entry of entries) {
    const childDisplay =
      display === "." ? `./${entry.name}` : `${display}/${entry.name}`;
    const type = entryType(entry);
    if (matchesEntry(type, entry.name, predicates))
      walk.lines.push(childDisplay);
    if (type === "d")
      await walkDirectory(
        walk,
        path.join(directory, entry.name),
        childDisplay,
        predicates,
      );
  }
}

/** Discover workspace paths under one contained root with native enumeration. */
export async function runNativeFindDiscovery(
  root: string,
  predicateArgs: readonly string[],
  context?: WorkspaceContext,
): Promise<InlineCommandResult> {
  try {
    const predicates = parseNativePredicates(predicateArgs);
    if (predicates === null) return { stdout: "", exitCode: 1 };
    const workspaceRoot = workspaceDirectory(context);
    const startDirectory = path.resolve(workspaceRoot, root);
    const rootDisplay = root === "." ? "." : root;
    // The canonical root was already validated upstream; this lexical guard
    // keeps malformed or escaping operands from starting an enumeration.
    if (rootDisplay !== "." && !isPathWithin(workspaceRoot, startDirectory))
      return { stdout: "", exitCode: 1 };
    const walk = await startFindWalk(startDirectory, rootDisplay, predicates);
    if (walk.failed) return { stdout: "", exitCode: 1 };
    return {
      stdout: walk.lines.map((line) => `${line}\n`).join(""),
      exitCode: 0,
    };
  } catch {
    return { stdout: "", exitCode: 1 };
  }
}
