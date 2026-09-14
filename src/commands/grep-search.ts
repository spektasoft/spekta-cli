import { execa } from "execa";
import { buildGrepArgs, GrepOptions } from "./grep-args-builder";
import { parseGrepOutput, MAX_MATCHES } from "./grep-output-parser";
import { validatePathAccess } from "../utils/security";

export type { GrepOptions };
export { MAX_MATCHES };

export async function getGrepContent(options: GrepOptions): Promise<string> {
  const { pattern, path: searchPath = "." } = options;

  // SECURITY: Reject empty/whitespace patterns to prevent full-codebase scans
  if (!pattern || pattern.trim() === "") {
    throw new Error("Pattern cannot be empty or whitespace-only.");
  }

  // Security check
  await validatePathAccess(searchPath);

  try {
    await execa("rg", ["--version"]);
  } catch {
    throw new Error(
      "ripgrep (rg) is not installed. Please install it to use the search tool.",
    );
  }

  const args = await buildGrepArgs(options);
  // Pin cwd explicitly so git-root and ignore-file resolution can never
  // drift from the invoking shell's working directory.
  const child = execa("rg", args, { cwd: process.cwd() });

  return parseGrepOutput(child);
}
