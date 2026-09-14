import { confirm } from "@inquirer/prompts";
import { execa } from "execa";
import path from "path";

import { getTokenCount } from "../utils/read-utils";
import {
  isCommandSafe,
  redactSecrets,
  validateCommandArguments,
} from "./proxy-security";

export {
  isCommandSafe,
  redactSecrets,
  validateCommandArguments,
} from "./proxy-security";

const FORCE_FLAG = "--spekta-force";
const MAX_OUTPUT_TOKENS = 1000;
const HEAD_TOKENS = 200;
const TAIL_TOKENS = 750;
const COLLAPSE_NOTICE = "... [X lines collapsed: exceeds 1000 tokens] ...";

function takeTokens(text: string, maxTokens: number): string {
  const lines = text.split("\n");
  const selected: string[] = [];
  let tokens = 0;

  for (const line of lines) {
    const lineTokens = getTokenCount(line + "\n");

    if (tokens + lineTokens > maxTokens) {
      break;
    }

    selected.push(line);
    tokens += lineTokens;
  }

  return selected.join("\n");
}

export function truncateOutput(
  output: string,
  maxTokens = MAX_OUTPUT_TOKENS,
): { content: string; truncated: boolean } {
  if (getTokenCount(output) <= maxTokens) {
    return { content: output, truncated: false };
  }

  const head = takeTokens(output, Math.min(HEAD_TOKENS, maxTokens));
  const tailSource = output.split("\n").reverse().join("\n");
  const tail = takeTokens(tailSource, Math.min(TAIL_TOKENS, maxTokens))
    .split("\n")
    .reverse()
    .join("\n");

  const remainingLines = Math.max(
    0,
    output.split("\n").length -
      head.split("\n").length -
      tail.split("\n").length,
  );

  const notice = COLLAPSE_NOTICE.replace("[X", `[${remainingLines}`);

  return {
    content: `${head}\n${notice}\n${tail}`.trim(),
    truncated: true,
  };
}

export function formatProxyOutput(
  command: string,
  output: string,
  options: { truncated?: boolean; exitCode?: number } = {},
): string {
  const badges = [
    options.truncated ? "[OUTPUT TRUNCATED: >1000 TOKENS]" : "",
    options.exitCode !== undefined && options.exitCode !== 0
      ? `[FAILED: Exit ${options.exitCode}]`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const heading = `### spekta ${redactSecrets(command)}${
    badges ? ` ${badges}` : ""
  }`;

  return `${heading}\n\n\`\`\`\n${redactSecrets(output)}\n\`\`\``;
}

function stripForceFlag(args: string[]): {
  cleanArgs: string[];
  forced: boolean;
} {
  const forced = args.includes(FORCE_FLAG);

  return {
    cleanArgs: args.filter((arg) => arg !== FORCE_FLAG),
    forced,
  };
}

export async function isRtkAvailable(): Promise<boolean> {
  try {
    await execa("rtk", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

export async function runRtkProxy(
  command: string,
  rawArgs: string[],
): Promise<void> {
  const { cleanArgs, forced } = stripForceFlag(rawArgs);

  validateCommandArguments(cleanArgs);

  if (!forced && !(await authorizeUnsafeCommand(command, cleanArgs))) {
    return;
  }

  if (!(await isRtkAvailable())) {
    console.log(
      [
        "### spekta rtk unavailable",
        "",
        "The `rtk` executable was not found.",
        "Install RTK with the `rtk-ai` package, then retry the command.",
      ].join("\n"),
    );
    return;
  }

  const result = await execa("rtk", [command, ...cleanArgs], {
    reject: false,
    env: {
      ...process.env,
      NO_COLOR: "1",
      TERM: "dumb",
    },
  });

  const rawOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");

  const redactedOutput = redactSecrets(rawOutput);
  const truncated = truncateOutput(redactedOutput);

  console.log(
    formatProxyOutput(command, truncated.content, {
      truncated: truncated.truncated,
      exitCode: result.exitCode ?? undefined,
    }),
  );
}

async function authorizeUnsafeCommand(
  command: string,
  args: string[],
): Promise<boolean> {
  if (isCommandSafe(command, args)) {
    return true;
  }

  if (process.stdin.isTTY) {
    return confirm({
      message: `The command "${redactSecrets(
        [command, ...args].join(" "),
      )}" may modify or delete data. Continue?`,
      default: false,
    });
  }

  console.log(
    [
      "### spekta security advisory",
      "",
      "The requested command is classified as mutating or destructive.",
      "Execution was blocked because the process is non-interactive.",
      "",
      "Append `--spekta-force` to explicitly authorize this command.",
    ].join("\n"),
  );

  return false;
}
