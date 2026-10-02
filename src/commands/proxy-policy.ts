import fs from "fs-extra";
import path from "path";
import { validateCommandArguments } from "./proxy-path-security";
import { redactSecrets } from "./proxy-secret-redaction";
import { truncateOutput } from "./proxy-output";
import { validateGitProxyRequest } from "./proxy-git-policy";
import { validateFindProxyRequest } from "./proxy-find-policy";

export function validateProxyRequest(command: string, args: string[]): void {
  if (
    args.some(
      (arg) => arg === "--spekta-force" || arg.startsWith("--spekta-force="),
    )
  ) {
    throw new Error("Execution refused: unsupported option '--spekta-force'.");
  }
  if (command === "git") {
    validateGitProxyRequest(args);
    return;
  }
  if (command === "find") {
    validateFindProxyRequest(args);
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
  validateCommandArguments([directory]);
  let isDirectory = false;
  try {
    isDirectory = fs
      .statSync(path.resolve(process.cwd(), directory))
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

export function formatProxyFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return truncateOutput(redactSecrets(message)).content;
}
