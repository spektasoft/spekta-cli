import { confirm } from "@inquirer/prompts";
import { execa } from "execa";
import path from "path";
import { RESTRICTED_FILES } from "../utils/security";
import { getTokenCount } from "../utils/read-utils";

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

const SAFE_COMMANDS = new Set([
  "vitest",
  "jest",
  "pytest",
  "tsc",
  "eslint",
  "ruff",
  "clippy",
  "biome",
  "tree",
  "ps",
  "ls",
]);

const SAFE_SUBCOMMANDS = new Set([
  "status",
  "log",
  "diff",
  "show",
  "branch",
  "test",
  "check",
  "lint",
  "build",
]);

const MULTI_TOOL_COMMANDS = new Set([
  "git",
  "cargo",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "docker",
]);

export function isCommandSafe(command: string, args: string[]): boolean {
  if (SAFE_COMMANDS.has(command)) {
    return true;
  }

  if (!MULTI_TOOL_COMMANDS.has(command)) {
    return false;
  }

  const subcommand = args.find((arg) => !arg.startsWith("-"));

  if (!subcommand) {
    return false;
  }

  if (command === "npm" && subcommand === "run") {
    const script = args.find(
      (arg, index) => index > args.indexOf("run") && !arg.startsWith("-"),
    );
    return script === "build";
  }

  return SAFE_SUBCOMMANDS.has(subcommand);
}

function isInsideProject(targetPath: string): boolean {
  const absolutePath = path.resolve(process.cwd(), targetPath);
  const relativePath = path.relative(process.cwd(), absolutePath);

  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function targetsRestrictedFile(targetPath: string): boolean {
  const absolutePath = path.resolve(process.cwd(), targetPath);
  const segments = absolutePath.split(path.sep).filter(Boolean);

  return segments.some((segment) => RESTRICTED_FILES.includes(segment));
}

function looksLikePathArgument(argument: string): boolean {
  return (
    argument === "." ||
    argument === ".." ||
    RESTRICTED_FILES.includes(argument) ||
    argument.startsWith("./") ||
    argument.startsWith("../") ||
    argument.startsWith("~/") ||
    argument.startsWith("/") ||
    argument.includes("/") ||
    argument.includes("\\")
  );
}

export function validateCommandArguments(args: string[]): void {
  for (const argument of args) {
    if (targetsRestrictedFile(argument)) {
      throw new Error(
        `Access Denied: command argument '${argument}' targets a restricted file or path.`,
      );
    }

    if (!looksLikePathArgument(argument)) {
      continue;
    }

    if (!isInsideProject(argument)) {
      throw new Error(
        `Access Denied: command argument '${argument}' resolves outside the project directory.`,
      );
    }
  }
}

export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/gh[po]_[A-Za-z0-9_]+/g, "[REDACTED]")
    .replace(/glpat-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED]")
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
      "[REDACTED]",
    )
    .replace(/api_key\s*=\s*[^\s"'`]+/gi, "api_key=[REDACTED]");
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
