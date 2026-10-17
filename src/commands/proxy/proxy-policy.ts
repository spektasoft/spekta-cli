import type { WorkspaceContext } from "../../utils/workspace";
import { redactSecrets } from "./proxy-secret-redaction";
import { truncateOutput } from "./proxy-output";
import { validateGitProxyRequest } from "./proxy-git-policy";
import { parseFindBatch } from "./proxy-find-batch-parser";

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
    // Discovery roots are classified independently by the batch executor.
    // Parsing here validates the whole grammar without revealing whether a
    // root exists or is eligible.
    parseFindBatch(args);
    return;
  }
  if (command !== "ls") {
    throw new Error(`Execution refused: unsupported command '${command}'.`);
  }
  const option = args.find((arg) => arg.startsWith("-"));
  if (option !== undefined) {
    throw new Error(
      "usage_error: Unsupported option for ls. Use spekta help ls.",
    );
  }
  if (
    args.some((directory) => directory === "" || /[\0\r\n]/.test(directory))
  ) {
    throw new Error("Execution refused: invalid directory operand.");
  }
}

/** Classifies literal discovery requests that Spekta can safely receive. */
export function isSupportedDiscoveryRequest(
  command: string,
  args: string[],
): boolean {
  if (command === "ls")
    return !args.some(
      (arg) => arg.startsWith("-") || arg === "" || /[\0\r\n]/.test(arg),
    );
  if (command !== "find") return false;

  try {
    parseFindBatch(args);
    return true;
  } catch {
    return false;
  }
}

/** Classifies standalone Git inspections using the proxy's execution policy. */
export function isSupportedGitProxyRequest(
  args: string[],
  cwd: string,
): boolean {
  try {
    validateGitProxyRequest(args, { root: cwd });
    const subcommand = args[0];
    if (subcommand === "log" || subcommand === "show") {
      const separator = args.indexOf("--");
      const flags = args.slice(1, separator < 0 ? args.length : separator);
      const summary = flags.some((flag) =>
        ["--stat", "--name-only", "--name-status"].includes(flag),
      );
      if (
        flags.some((flag) =>
          [
            "--oneline",
            "--graph",
            "--decorate",
            "--decorate=short",
            "--decorate=full",
            "--all",
          ].includes(flag),
        )
      ) {
        return false;
      }
      if (summary && flags.some((flag) => ["-p", "--patch"].includes(flag)))
        return false;
      if (
        subcommand === "log" &&
        !summary &&
        !flags.some((flag) => ["-p", "--patch"].includes(flag))
      ) {
        return false;
      }
      if (subcommand === "show" && flags.includes("--no-patch") && !summary)
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function formatProxyFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return truncateOutput(redactSecrets(message)).content;
}
