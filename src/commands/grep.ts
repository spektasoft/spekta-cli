import { execa } from "execa";
import fs from "fs-extra";
import readline from "node:readline";
import { HOME_IGNORE } from "../config";
import { Logger } from "../utils/logger";
import { validatePathAccess } from "../utils/security";

interface GrepOptions {
  pattern: string;
  path?: string;
  globs?: string;
  case_insensitive?: boolean;
}

export async function getGrepContent(options: GrepOptions): Promise<string> {
  const { pattern, path: searchPath = ".", globs, case_insensitive } = options;

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

  const args = [
    pattern,
    searchPath,
    "--line-number",
    "--column",
    "--color=never",
    "--heading",
    "--smart-case",
    "--json", // Use JSON for robust parsing into multiple blocks
  ];

  // Only force flags if explicitly requested
  if (case_insensitive === true) {
    args.push("--ignore-case");
  } else if (case_insensitive === false) {
    args.push("--case-sensitive");
  }

  if (globs) args.push("-g", globs);
  if (await fs.pathExists(HOME_IGNORE)) args.push("--ignore-file", HOME_IGNORE);

  const child = execa("rg", args);
  const resultsByFile: Record<string, string[]> = {};

  let totalMatches = 0;
  const MAX_MATCHES = 500;
  const MAX_FILES = 100;
  let truncated = false;

  if (child.stdout) {
    const rl = readline.createInterface({
      input: child.stdout,
      terminal: false,
    });

    for await (const line of rl) {
      if (
        totalMatches >= MAX_MATCHES ||
        Object.keys(resultsByFile).length >= MAX_FILES
      ) {
        truncated = true;
        child.kill();
        break;
      }
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "match") {
          const filePath = parsed.data.path.text;
          const lineNum = parsed.data.line_number;
          const colNums = parsed.data.submatches
            .map((m: any) => m.start)
            .join(",");
          const text = parsed.data.lines.text.trimEnd();

          if (!resultsByFile[filePath]) resultsByFile[filePath] = [];
          resultsByFile[filePath].push(`${lineNum}:${colNums}:${text}`);
          totalMatches++;
        }
      } catch (e) {
        // Skip invalid JSON lines
        continue;
      }
    }
  }

  try {
    await child;
  } catch (error: any) {
    // exitCode 1 means no matches found, which is fine
    // if we truncated, we killed the process, which is also fine
    if (error.exitCode !== 1 && !truncated) {
      throw new Error(`Ripgrep error: ${error.message}`);
    }
  }

  if (Object.keys(resultsByFile).length === 0) {
    return "No matches found.";
  }

  let output = Object.entries(resultsByFile)
    .map(([file, matches]) => {
      // Extract extension (e.g., 'file.ts' -> 'ts')
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

export async function runGrep(args?: string[]) {
  try {
    // Basic argument parsing: spekta grep <pattern> [path] [--glob <glob>]
    const safeArgs = args || [];
    const pattern = safeArgs[0];
    const path =
      safeArgs[1] && !safeArgs[1].startsWith("-") ? safeArgs[1] : ".";
    const globIdx = safeArgs.indexOf("--glob");
    const globs = globIdx !== -1 ? safeArgs[globIdx + 1] : undefined;

    if (!pattern) {
      Logger.error("Usage: spekta grep <pattern> [path] [--glob <glob>]");
      process.exit(1);
    }

    const content = await getGrepContent({ pattern, path, globs });
    process.stdout.write(content + "\n");
  } catch (error: any) {
    Logger.error(error.message);
    process.exitCode = 1;
  }
}
