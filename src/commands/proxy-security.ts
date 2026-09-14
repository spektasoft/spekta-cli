import fs from "fs-extra";
import path from "path";

import { validateCommandArguments } from "./proxy-path-security";
import { redactSecrets } from "./proxy-secret-redaction";

export { validateCommandArguments } from "./proxy-path-security";
export { redactSecrets } from "./proxy-secret-redaction";

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

const UNSAFE_OPTION_BY_COMMAND: Record<string, Set<string>> = {
  git: new Set(["-C", "--git-dir", "--work-tree", "-c", "--config-env"]),
};

function hasUnsafeCommandOption(command: string, args: string[]): boolean {
  const unsafeOptions = UNSAFE_OPTION_BY_COMMAND[command];
  if (!unsafeOptions) {
    return false;
  }

  return args.some((argument) => {
    for (const option of unsafeOptions) {
      if (argument === option || argument.startsWith(`${option}=`)) {
        return true;
      }
    }
    return false;
  });
}

function findUnambiguousSubcommand(args: string[]): string | undefined {
  if (args.length === 0) {
    return undefined;
  }

  for (const argument of args) {
    if (argument === "--") {
      return undefined;
    }

    if (argument.startsWith("-")) {
      return undefined;
    }

    return argument;
  }

  return undefined;
}

/**
 * Safe classification intentionally fails closed when options precede the
 * subcommand. This avoids interpreting an option value as a subcommand.
 * Invocations relying on global options can still proceed through the
 * existing explicit authorization path.
 */
export function isCommandSafe(command: string, args: string[]): boolean {
  if (SAFE_COMMANDS.has(command)) {
    return true;
  }

  if (!MULTI_TOOL_COMMANDS.has(command)) {
    return false;
  }

  if (hasUnsafeCommandOption(command, args)) {
    return false;
  }

  const subcommand = findUnambiguousSubcommand(args);
  if (!subcommand) {
    return false;
  }

  if (command === "npm" && subcommand === "run") {
    const runIndex = args.indexOf("run");
    const script = args.find(
      (arg, index) => index > runIndex && !arg.startsWith("-"),
    );
    return script === "build";
  }

  return SAFE_SUBCOMMANDS.has(subcommand);
}

// Path validation is implemented in ./proxy-path-security.
