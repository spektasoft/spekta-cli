import readline from "node:readline";
import { getGrepTokenLimit } from "../core/config";
import { getTokenCount } from "../utils/read-utils";
import { isPathIgnored } from "../utils/path-ignore";

export const MAX_MATCHES = 500;
const MAX_FILES = 100;

export async function parseGrepOutput(child: any): Promise<string> {
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
        child.kill();
        break;
      }
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "match") {
          const filePath = parsed.data.path.text;

          let isIgnored = ignoreCache.get(filePath);
          if (isIgnored === undefined) {
            isIgnored = await isPathIgnored(filePath);
            ignoreCache.set(filePath, isIgnored);
          }
          if (isIgnored) {
            continue;
          }

          const lineNum = parsed.data.line_number;
          const colNums = parsed.data.submatches
            .map((m: any) => m.start)
            .join(",");
          const text = parsed.data.lines.text.trimEnd();
          const formattedLine = `${lineNum}:${colNums}:${text}`;

          if (!resultsByFile[filePath]) resultsByFile[filePath] = [];
          resultsByFile[filePath].push(formattedLine);
          totalMatches++;
          totalTokens += getTokenCount(formattedLine);
        }
      } catch (e) {
        continue;
      }
    }
  }

  try {
    await child;
  } catch (error: any) {
    if (error.exitCode !== 1 && !truncated) {
      throw new Error(`Ripgrep error: ${error.message}`);
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
