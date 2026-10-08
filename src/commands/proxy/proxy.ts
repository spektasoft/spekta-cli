import { renderGitStatusOutcome } from "./proxy-git-status";
import { renderGitBranchOutcome } from "./proxy-git-branch";
import { renderGitHistoryOutcome } from "./proxy-git-history";
import { renderGitBlobOutcome } from "./proxy-git-blob";
import {
  executeGitHistoryPatchOutcome,
  isGitHistoryPatchRequest,
} from "./proxy-git-history-patch";
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
      console.log(
        formatProxyOutput(command, outcome.message, {
          exitCode: outcome.exitCode,
        }),
      );
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
      console.log(
        formatProxyOutput(command, outcome.message, {
          exitCode: outcome.exitCode,
        }),
      );
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
      console.log(
        formatProxyOutput(command, outcome.message, {
          exitCode: outcome.exitCode,
        }),
      );
    } else
      console.log(
        formatProxyOutput(command, outcome.content, {
          truncated: outcome.truncated,
        }),
      );
    return;
  }

  if (command === "git" && rawArgs[0] === "branch") {
    const outcome = renderGitBranchOutcome(result);
    if (outcome.status === "failure") {
      process.exitCode = outcome.exitCode;
      console.log(
        formatProxyOutput(command, outcome.message, {
          exitCode: outcome.exitCode,
        }),
      );
    } else {
      console.log(
        formatProxyOutput(command, outcome.content, {
          truncated: outcome.truncated,
        }),
      );
    }
    return;
  }

  if (
    command === "git" &&
    rawArgs[0] === "show" &&
    rawArgs.some(
      (arg, index) => index > 0 && !arg.startsWith("-") && arg.includes(":"),
    )
  ) {
    const selector = rawArgs.find(
      (arg, index) => index > 0 && !arg.startsWith("-") && arg.includes(":"),
    )!;
    const outcome = await renderGitBlobOutcome(result, selector, context);
    if (outcome.status === "failure") {
      process.exitCode = outcome.exitCode;
      console.log(
        formatProxyOutput(command, outcome.message, {
          exitCode: outcome.exitCode,
        }),
      );
    } else {
      console.log(
        formatProxyOutput(command, outcome.content, {
          truncated: outcome.truncated,
        }),
      );
    }
    return;
  }

  if (command === "git" && isGitHistoryPatchRequest(rawArgs)) {
    const outcome = await executeGitHistoryPatchOutcome(rawArgs, context);
    if (outcome.status === "failure") {
      process.exitCode = outcome.exitCode;
      console.log(
        formatProxyOutput(command, outcome.message, {
          exitCode: outcome.exitCode,
        }),
      );
    } else
      console.log(
        formatProxyOutput(command, outcome.content, {
          truncated: outcome.truncated,
        }),
      );
    return;
  }

  if (
    command === "git" &&
    ["log", "show"].includes(rawArgs[0]) &&
    (rawArgs[0] === "log" ||
      rawArgs.some((arg) =>
        ["--stat", "--name-only", "--name-status"].includes(arg),
      ))
  ) {
    const outcome = await renderGitHistoryOutcome(result, rawArgs, context);
    if (outcome.status === "failure") {
      process.exitCode = outcome.exitCode;
      console.log(
        formatProxyOutput(command, outcome.message, {
          exitCode: outcome.exitCode,
        }),
      );
    } else console.log(formatProxyOutput(command, outcome.content));
    return;
  }

  if (command === "git" && rawArgs[0] === "diff") {
    const outcome = await renderGitDiffOutcome(result, rawArgs, context);
    if (outcome.status === "failure") {
      process.exitCode = outcome.exitCode;
      console.log(
        formatProxyOutput(command, outcome.message, {
          exitCode: outcome.exitCode,
        }),
      );
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
