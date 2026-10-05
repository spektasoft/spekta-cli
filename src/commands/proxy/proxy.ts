import { renderGitStatusOutcome } from "./proxy-git-status";
import {
  executeGitDiffPatchOutcome,
  renderGitDiffOutcome,
} from "./proxy-git-diff";
import { executeRtkCommand } from "./proxy-execution";
import { formatProxyFailure, validateProxyRequest } from "./proxy-policy";
import { formatProxyOutput, truncateOutput } from "./proxy-output";
import { renderDiscoveryOutcome } from "./proxy-ls-render";
import type { WorkspaceContext } from "../../utils/workspace";

export type { WorkspaceContext } from "../../utils/workspace";

export { isRtkAvailable } from "./proxy-execution";

export { formatProxyOutput, truncateOutput } from "./proxy-output";

export { redactSecrets, validateCommandArguments } from "./proxy-security";

export async function runRtkProxy(
  command: string,
  rawArgs: string[],
  context?: WorkspaceContext,
): Promise<void> {
  try {
    validateProxyRequest(command, rawArgs, context);
  } catch (error: unknown) {
    console.error(formatProxyFailure(error));
    process.exitCode = 1;
    return;
  }
  if (
    command === "git" &&
    rawArgs[0] === "diff" &&
    !rawArgs.some((arg) =>
      ["--name-only", "--name-status", "--stat"].includes(arg),
    )
  ) {
    const outcome = await executeGitDiffPatchOutcome(rawArgs, context);
    if (outcome.status === "failure") {
      process.exitCode = outcome.exitCode;
      console.error(outcome.message);
    } else {
      console.log(
        formatProxyOutput(command, outcome.content, {
          truncated: outcome.truncated,
        }),
      );
    }
    return;
  }
  let result;
  try {
    result = await executeRtkCommand(command, rawArgs, context);
  } catch (error: unknown) {
    console.error(
      (command === "git" && rawArgs[0] === "status") ||
        command === "ls" ||
        command === "find"
        ? "RTK listing failed before output could be checked."
        : formatProxyFailure(error),
    );
    process.exitCode = 1;
    return;
  }

  if (!result.available) {
    console.error(
      [
        "### spekta rtk unavailable",
        "",
        "The `rtk` executable was not found.",
        "Install RTK with the `rtk-ai` package, then retry the command.",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  if (command === "ls" || command === "find") {
    const outcome = await renderDiscoveryOutcome(
      result,
      rawArgs[0]?.startsWith("-") ? "." : rawArgs[0],
      context,
      command,
    );
    if (outcome.status === "failure") {
      process.exitCode = outcome.exitCode;
      console.error(outcome.message);
      return;
    }
    console.log(
      formatProxyOutput(command, outcome.content, {
        truncated: outcome.truncated,
      }),
    );
    return;
  }

  if (command === "git" && rawArgs[0] === "status") {
    const outcome = await renderGitStatusOutcome(result, rawArgs, context);
    if (outcome.status === "failure") {
      process.exitCode = outcome.exitCode;
      console.error(outcome.message);
    } else
      console.log(
        formatProxyOutput(command, outcome.content, {
          truncated: outcome.truncated,
        }),
      );
    return;
  }

  if (command === "git" && rawArgs[0] === "diff") {
    const outcome = await renderGitDiffOutcome(result, rawArgs, context);
    if (outcome.status === "failure") {
      process.exitCode = outcome.exitCode;
      console.error(outcome.message);
    } else {
      console.log(
        formatProxyOutput(command, outcome.content, {
          truncated: outcome.truncated,
        }),
      );
    }
    return;
  }

  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
    console.error(`RTK command failed with exit status ${result.exitCode}.`);
  }

  const rawOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");

  const truncated = truncateOutput(rawOutput);

  console.log(
    formatProxyOutput(command, truncated.content, {
      truncated: truncated.truncated,
      exitCode: result.exitCode,
    }),
  );
}
