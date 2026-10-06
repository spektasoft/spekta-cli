import fs from "fs-extra";
import path from "path";
import { validateCommandArguments } from "./proxy-path-security";
import type { WorkspaceContext } from "../../utils/workspace";
import { redactSecrets } from "./proxy-secret-redaction";
import { truncateOutput } from "./proxy-output";
import { validateGitProxyRequest } from "./proxy-git-policy";
import { validateFindProxyRequest } from "./proxy-find-policy";

export function validateProxyRequest(
  command: string,
  args: string[],
  context?: WorkspaceContext,
): void {
  if (
    args.some(
      (arg) => arg === "--spekta-force" || arg.startsWith("--spekta-force="),
    )
  ) {
    throw new Error("Execution refused: unsupported option '--spekta-force'.");
  }
  if (command === "git") {
    validateGitProxyRequest(args, context);
    return;
  }
  if (command === "find") {
    validateFindProxyRequest(args, context);
    return;
  }
  if (command !== "ls") {
    throw new Error(`Execution refused: unsupported command '${command}'.`);
  }
  const option = args.find((arg) => arg.startsWith("-"));
  if (option !== undefined) {
    throw new Error(`Execution refused: unsupported option '${option}'.`);
  }
  if (args.length > 1) {
    throw new Error(
      "Execution refused: ls supports at most one workspace-directory operand.",
    );
  }
  const directory = args[0] ?? ".";
  if (directory === "" || /[\0\r\n]/.test(directory)) {
    throw new Error("Execution refused: invalid directory operand.");
  }
  validateCommandArguments([directory], context);
  let isDirectory = false;
  try {
    isDirectory = fs
      .statSync(path.resolve(context?.root ?? process.cwd(), directory))
      .isDirectory();
  } catch {
    // Missing, broken, or inaccessible operands fail closed.
  }
  if (!isDirectory) {
    throw new Error(
      `Execution refused: '${directory}' must be an existing workspace directory.`,
    );
  }
}

/** Classifies literal discovery requests that Spekta can safely receive. */
export function isSupportedDiscoveryRequest(
  command: string,
  args: string[],
): boolean {
  if (command === "ls")
    return args.length <= 1 && !args.some((arg) => arg.startsWith("-"));
  if (command !== "find") return false;

  let index = args.length > 0 && !args[0].startsWith("-") ? 1 : 0;
  let seenType = false;
  let seenName = false;
  while (index < args.length) {
    const token = args[index];
    if (
      token === "-type" &&
      !seenType &&
      ["f", "d"].includes(args[index + 1] ?? "")
    ) {
      seenType = true;
      index += 2;
    } else if (token === "-name" && !seenName && Boolean(args[index + 1])) {
      seenName = true;
      index += 2;
    } else if (token === "-print" && index === args.length - 1) {
      return true;
    } else return false;
  }
  return true;
}

export function formatProxyFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return truncateOutput(redactSecrets(message)).content;
}
