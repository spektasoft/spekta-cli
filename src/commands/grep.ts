import { execa } from "execa";
import fs from "fs-extra";
import { validatePathAccess } from "../utils/security";
import { HOME_IGNORE } from "../config";
import { Logger } from "../utils/logger";

interface GrepOptions {
  pattern: string;
  path?: string;
  globs?: string;
  case_insensitive?: boolean;
}

export async function getGrepContent(options: GrepOptions): Promise<string> {
  const {
    pattern,
    path: searchPath = ".",
    globs,
    case_insensitive = true,
  } = options;

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

  if (case_insensitive) args.push("--ignore-case");
  if (globs) args.push("-g", globs);
  if (await fs.pathExists(HOME_IGNORE)) args.push("--ignore-file", HOME_IGNORE);

  try {
    const { stdout } = await execa("rg", args);
    const lines = stdout.split("\n").filter((l) => l.trim());

    if (lines.length === 0) return "No matches found.";

    const resultsByFile: Record<string, string[]> = {};

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "match") {
          const filePath = parsed.data.path.text;
          const lineNum = parsed.data.line_number;
          const colNum = parsed.data.submatches[0].start;
          const text = parsed.data.lines.text.trimEnd();

          if (!resultsByFile[filePath]) resultsByFile[filePath] = [];
          resultsByFile[filePath].push(`${lineNum}:${colNum}:${text}`);
        }
      } catch (e) {
        // Skip invalid JSON lines
        continue;
      }
    }

    return Object.entries(resultsByFile)
      .map(([file, matches]) => {
        return `#### ${file}\n\`\`\`text\n${matches.join("\n")}\n\`\`\``;
      })
      .join("\n\n");
  } catch (error: any) {
    if (error.exitCode === 1) return "No matches found.";
    throw new Error(`Ripgrep error: ${error.message}`);
  }
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
