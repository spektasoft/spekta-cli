import fs from "fs-extra";
import ignore from "ignore";
import path from "node:path";
import { getIgnorePatterns } from "../../core/config";
import {
  RESTRICTED_FILES,
  isWhitelisted,
  validateReadPathAccess,
} from "../../utils/security";
import type { ResolvedWorkspace } from "../../utils/workspace";

export type LsFilterResult =
  | { status: "success"; names: string[] }
  | { status: "ambiguous"; message: string };

const AMBIGUOUS_MESSAGE =
  "Listing rejected: directory entries could not be attributed reliably.";

const SIMPLE_ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  f: 12,
  n: 10,
  r: 13,
  t: 9,
  v: 11,
  "\\": 92,
  " ": 32,
};

/** Decode one `ls -b` entry, or return null for any unsupported form. */
function decodeLsName(encoded: string): string | null {
  const bytes: number[] = [];
  const chars = Array.from(encoded);
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    if (char !== "\\") {
      bytes.push(...Buffer.from(char, "utf8"));
      continue;
    }
    const next = chars[index + 1];
    if (next === undefined) return null;
    if (next in SIMPLE_ESCAPES) {
      bytes.push(SIMPLE_ESCAPES[next]);
      index += 1;
      continue;
    }
    if (/[0-7]/.test(next)) {
      let digits = "";
      while (digits.length < 3 && /[0-7]/.test(chars[index + 1] ?? "")) {
        digits += chars[index + 1];
        index += 1;
      }
      const value = parseInt(digits, 8);
      if (value > 255) return null;
      bytes.push(value);
      continue;
    }
    return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(bytes),
    );
  } catch {
    return null;
  }
}

function parseLsOutput(stdout: string): string[] | null {
  if (stdout === "") return [];
  const body = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  const names: string[] = [];
  for (const line of body.split("\n")) {
    if (line === "") return null;
    const name = decodeLsName(line);
    if (name === null || name === "." || name === ".." || name.includes("/")) {
      return null;
    }
    names.push(name);
  }
  return names;
}

/** Directory-only ignore patterns only match when the path ends in a slash. */
export function isIgnoredDirectory(
  relativePath: string,
  patterns: string[],
): boolean {
  return (
    isSpektaPathIgnored(relativePath, patterns) ||
    isSpektaPathIgnored(relativePath, patterns, true)
  );
}

export function isSpektaPathIgnored(
  relativePath: string,
  patterns: string[],
  directory = false,
): boolean {
  const normalized = relativePath.split(path.sep).join("/");
  const candidate = directory ? `${normalized}/` : normalized;
  try {
    return patterns.length > 0 && ignore().add(patterns).ignores(candidate);
  } catch {
    return true;
  }
}

export function isExplicitSpektaDirectoryIgnored(
  relativePath: string,
  patterns: string[],
): boolean {
  const candidate = relativePath.split(path.sep).join("/");
  return (
    isSpektaPathIgnored(relativePath, patterns, true) &&
    !isWhitelisted(candidate, patterns)
  );
}

export async function isEligibleEntry(
  directory: string,
  name: string,
  workspace: ResolvedWorkspace,
  patterns: string[],
): Promise<boolean> {
  try {
    const requested = path.join(directory, name);
    const absolutePath = path.resolve(workspace.root, requested);
    // The decoded name is a literal directory entry. Passing it as a relative
    // workspace path would normalize POSIX backslashes as separators.
    const canonicalPath = await validateReadPathAccess(
      absolutePath,
      workspace,
      { allowGitIgnored: true, skipSpektaIgnoreCheck: true },
    );
    const canonicalSegments = path
      .relative(workspace.canonicalRoot, canonicalPath)
      .split(path.sep);
    if (canonicalSegments.some((part) => RESTRICTED_FILES.includes(part))) {
      return false;
    }
    const isDirectory = (await fs.stat(canonicalPath)).isDirectory();
    const requestedRelative = path.relative(workspace.root, absolutePath);
    const canonicalRelative = path.relative(
      workspace.canonicalRoot,
      canonicalPath,
    );
    for (const relative of new Set([requestedRelative, canonicalRelative])) {
      if (
        relative !== "" &&
        (isDirectory
          ? isIgnoredDirectory(relative, patterns)
          : isSpektaPathIgnored(relative, patterns))
      ) {
        return false;
      }
    }
    return true;
  } catch {
    // Denied, escaping, dangling, or unreadable entries are never disclosed.
    return false;
  }
}

/**
 * Keep only eligible entries from raw `ls -1Ab` output. Every decoded name must
 * exist in the directory itself; anything else is rejected rather than guessed.
 */
export async function filterEligibleLsEntries(
  stdout: string,
  directory: string,
  workspace: ResolvedWorkspace,
): Promise<LsFilterResult> {
  const ambiguous: LsFilterResult = {
    status: "ambiguous",
    message: AMBIGUOUS_MESSAGE,
  };
  const decoded = parseLsOutput(stdout);
  if (decoded === null) return ambiguous;

  let actual: Set<string>;
  try {
    actual = new Set(await fs.readdir(path.resolve(workspace.root, directory)));
  } catch {
    return ambiguous;
  }
  if (decoded.some((name) => !actual.has(name))) return ambiguous;

  let patterns: string[];
  try {
    patterns = await getIgnorePatterns(workspace.canonicalRoot);
  } catch {
    // Without the ignore rules, eligibility cannot be established.
    return ambiguous;
  }
  const names: string[] = [];
  for (const name of decoded) {
    if (await isEligibleEntry(directory, name, workspace, patterns)) {
      names.push(name);
    }
  }
  return { status: "success", names };
}
