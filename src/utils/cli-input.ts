import { Logger } from "./logger";

export interface ResolvedCommandInput {
  filePath: string;
  content: string;
}

/**
 * Resolves target path and payload content from either positional CLI arguments
 * or standard input (heredoc/pipeline), guarding against interactive TTY hanging.
 */
export async function resolveCommandInput(
  args: string[] | undefined,
  usageMessage: string,
): Promise<ResolvedCommandInput | null> {
  const safeArgs = args || [];
  if (safeArgs.length === 0) {
    Logger.error(usageMessage);
    process.exitCode = 1;
    return null;
  }

  const filePath = safeArgs[0];

  // Inline argument payload
  if (safeArgs.length >= 2) {
    const content = safeArgs.slice(1).join(" ");
    return { filePath, content };
  }

  // Guard against hanging on interactive terminal inputs
  if (process.stdin.isTTY) {
    Logger.error(usageMessage);
    process.exitCode = 1;
    return null;
  }

  // Stream piped/heredoc content
  let stdinContent = "";
  for await (const chunk of process.stdin) {
    stdinContent += chunk;
  }

  if (!stdinContent.trim()) {
    Logger.error("No content provided via stdin.");
    process.exitCode = 1;
    return null;
  }

  return { filePath, content: stdinContent };
}
