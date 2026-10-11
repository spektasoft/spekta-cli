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
import {
  getListBatchOutcome,
  listContentAllowance,
  listAllowanceIncreaseHint,
  resolveListAllowance,
  RtkListingUnavailableError,
} from "./proxy-ls-batch";
import type { WorkspaceContext } from "../../utils/workspace";

export type { WorkspaceContext } from "../../utils/workspace";

export { isRtkAvailable } from "./proxy-execution";

export { formatProxyOutput, truncateOutput } from "./proxy-output";

export { redactSecrets, validateCommandArguments } from "./proxy-security";

function splitLsArgs(args: string[]): {
  operands: string[];
  allowance?: string;
  malformed: boolean;
} {
  const operands: string[] = [];
  let allowance: string | undefined;
  let malformed = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--allowance" || arg.startsWith("--allowance=")) {
      const value =
        arg === "--allowance"
          ? args[++index]
          : arg.slice("--allowance=".length);
      if (value === undefined || allowance !== undefined) malformed = true;
      else allowance = value;
    } else operands.push(arg);
  }
  return { operands, allowance, malformed };
}

export async function runRtkProxy(
  command: string,
  rawArgs: string[],
  context?: WorkspaceContext,
): Promise<void> {
  const lsArgs = command === "ls" ? splitLsArgs(rawArgs) : undefined;
  const requestArgs = lsArgs?.operands ?? rawArgs;
  if (lsArgs?.malformed) {
    console.error(
      "usage_error: ls accepts one --allowance value. Use spekta help ls.",
    );
    process.exitCode = 1;
    return;
  }
  try {
    validateProxyRequest(command, requestArgs, context);
  } catch (error: unknown) {
    console.error(formatProxyFailure(error));
    process.exitCode = 1;
    return;
  }
  if (command === "ls") {
    const resolvedAllowance = resolveListAllowance(lsArgs?.allowance);
    if (resolvedAllowance.failure) {
      process.exitCode = 1;
      console.log(
        formatProxyOutput("ls", resolvedAllowance.failure.message, {
          exitCode: 1,
        }),
      );
      return;
    }
    const allowance = resolvedAllowance.allowance ?? 1000;
    const outcome = await getListBatchOutcome(requestArgs, context, {
      allowance: listContentAllowance(allowance),
      increaseHint: listAllowanceIncreaseHint(allowance),
      runLs: async (operand) => {
        const result = await executeRtkCommand("ls", [operand], context);
        if (!result.available) throw new RtkListingUnavailableError();
        return { stdout: result.stdout, exitCode: result.exitCode };
      },
    });
    if (outcome.status === "failure") {
      process.exitCode = outcome.exitCode;
      if (
        outcome.message === "RTK listing failed before output could be checked."
      ) {
        console.error(outcome.message);
      } else {
        console.log(
          formatProxyOutput("ls", outcome.message, {
            exitCode: outcome.exitCode,
          }),
        );
      }
      return;
    }
    if (outcome.status === "partial_result") process.exitCode = 1;
    console.log(
      formatProxyOutput("ls", outcome.content, {
        truncated: outcome.truncated,
      }),
    );
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

  if (command === "find") {
    const outcome = await renderDiscoveryOutcome(
      result,
      rawArgs[0]?.startsWith("-") ? "." : rawArgs[0],
      context,
      "find",
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
