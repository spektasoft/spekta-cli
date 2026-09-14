import path from "path";

import { RESTRICTED_FILES } from "../utils/security";

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
