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
import { executeRtkCommand, isRtkAvailable } from "./proxy-execution";
import { formatProxyFailure, validateProxyRequest } from "./proxy-policy";
import { formatProxyOutput, truncateOutput } from "./proxy-output";
import {
  getListBatchOutcome,
  listContentAllowance,
  listAllowanceIncreaseHint,
  resolveListAllowance,
  RtkListingUnavailableError,
} from "./proxy-ls-batch";
import type { WorkspaceContext } from "../../utils/workspace";
import { resolveRequestAllowance } from "../../core/config/allowance";
import { getTokenCount } from "../../utils/read-utils";
import { boundGitCliResponse } from "./proxy-git-response-budget";
import {
  discoverFindBatch,
  getFindValidationFailure,
  getFindValidationText,
} from "./proxy-find-batch";

export type { WorkspaceContext } from "../../utils/workspace";

export { isRtkAvailable } from "./proxy-execution";

export { formatProxyOutput, truncateOutput } from "./proxy-output";

export { redactSecrets, validateCommandArguments } from "./proxy-security";

function emitGitResponse(
  text: string,
  allowance: number,
  exitCode = 0,
  truncated = false,
): void {
  const output = formatProxyOutput("git", text, { exitCode, truncated });
  const overflow = formatProxyOutput("git", "output_limit_exceeded", {
    exitCode: 1,
  });
  const bounded = boundGitCliResponse(output, allowance, overflow);
  process.exitCode = bounded === output ? exitCode : 1;
  console.log(bounded);
}

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

function splitFindArgs(args: string[]): {
  operands: string[];
  allowance?: string;
  malformed: boolean;
} {
  const operands = [...args];
  let allowance: string | undefined;
  let malformed = false;
  if (
    operands[0] === "--allowance" ||
    operands[0]?.startsWith("--allowance=")
  ) {
    const option = operands.shift()!;
    allowance = option === "--allowance" ? operands.shift() : option.slice(12);
    if (allowance === undefined) malformed = true;
  }
  // A name operand is literal, so skip it while locating misplaced options.
  for (let index = 0; index < operands.length; index++) {
    const token = operands[index];
    if (token === "-name") {
      index++;
      continue;
    }
    if (token === "--allowance" || token.startsWith("--allowance="))
      malformed = true;
  }
  return { operands, allowance, malformed };
}

function splitGitArgs(args: string[]): {
  operands: string[];
  allowance?: string;
  malformed: boolean;
} {
  const operands: string[] = [];
  let allowance: string | undefined;
  let malformed = false;
  const separator = args.indexOf("--");
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (
      index < (separator < 0 ? args.length : separator) &&
      (arg === "--allowance" || arg.startsWith("--allowance="))
    ) {
      const value = arg === "--allowance" ? args[++index] : arg.slice(12);
      if (value === undefined || allowance !== undefined) malformed = true;
      else allowance = value;
    } else operands.push(arg);
  }
  return { operands, allowance, malformed };
}

function findCliResponse(text: string, isError: boolean): string {
  return `${formatProxyOutput("find", text, isError ? { exitCode: 1 } : {})}\n`;
}

function findCliMeasure(text: string, isError: boolean): number {
  return getTokenCount(findCliResponse(text, isError));
}

export async function runRtkProxy(
  command: string,
  rawArgs: string[],
  context?: WorkspaceContext,
): Promise<void> {
  const lsArgs = command === "ls" ? splitLsArgs(rawArgs) : undefined;
  const findArgs = command === "find" ? splitFindArgs(rawArgs) : undefined;
  const gitArgs = command === "git" ? splitGitArgs(rawArgs) : undefined;
  const requestArgs =
    lsArgs?.operands ?? findArgs?.operands ?? gitArgs?.operands ?? rawArgs;
  const gitAllowanceResult = gitArgs
    ? resolveRequestAllowance("git", gitArgs.allowance)
    : undefined;
  const gitAllowance =
    gitAllowanceResult?.status === "ok"
      ? (gitAllowanceResult.requested ??
        gitAllowanceResult.settings.defaultTokens)
      : (gitAllowanceResult?.settings.defaultTokens ?? 1000);
  if (gitArgs && (gitArgs.malformed || gitAllowanceResult?.status !== "ok")) {
    const settings = gitAllowanceResult!.settings;
    const message = gitArgs?.malformed
      ? "usage_error: git accepts one --allowance value. Use spekta help git."
      : gitAllowanceResult?.status === "invalid"
        ? "usage_error: Allowance must be a positive whole number. Use spekta help git."
        : `output_limit_exceeded: Allowance exceeds the configured Git ceiling of ${settings.ceilingTokens} tokens. Use spekta help git.`;
    process.exitCode = 1;
    emitGitResponse(message, gitAllowance, 1);
    return;
  }
  if (gitArgs) {
    const minimumAllowance = getTokenCount(
      `${formatProxyOutput("git", "output_limit_exceeded", { exitCode: 1 })}\n`,
    );
    if (gitAllowance < minimumAllowance) {
      emitGitResponse(
        `usage_error: Git response requires at least ${minimumAllowance} tokens; increase allowance.`,
        gitAllowanceResult!.settings.defaultTokens,
        1,
      );
      return;
    }
  }
  if (lsArgs?.malformed) {
    console.error(
      "usage_error: ls accepts one --allowance value. Use spekta help ls.",
    );
    process.exitCode = 1;
    return;
  }
  if (findArgs?.malformed) {
    const { settings } = resolveRequestAllowance("list", findArgs.allowance);
    const failure = getFindValidationFailure(
      findCliMeasure,
      settings.ceilingTokens,
      settings.defaultTokens,
      undefined,
      "usage_error: find accepts one leading --allowance value",
    );
    process.exitCode = 1;
    console.log(
      findCliResponse(getFindValidationText(failure), true).trimEnd(),
    );
    return;
  }
  try {
    validateProxyRequest(command, requestArgs, context);
  } catch (error: unknown) {
    if (command === "git") {
      emitGitResponse(formatProxyFailure(error), gitAllowance, 1);
      return;
    }
    if (command === "find") {
      const resolved = resolveRequestAllowance("list", findArgs?.allowance);
      const settings = resolved.settings;
      const allowance =
        resolved.status === "ok"
          ? (resolved.requested ?? settings.defaultTokens)
          : settings.defaultTokens;
      const outcome = await discoverFindBatch(requestArgs, context, {
        allowance,
        validationAllowance: settings.defaultTokens,
        maximumAllowance: settings.ceilingTokens,
        measure: findCliMeasure,
        metadataBytes: (text, isError) =>
          Buffer.byteLength(findCliResponse(text, isError), "utf8"),
        backend: () =>
          Promise.reject(new Error("unreachable after parser rejection")),
        hasRtk: true,
      });
      process.exitCode = 1;
      console.log(findCliResponse(outcome.content, true).trimEnd());
      return;
    }
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
  if (command === "find") {
    const resolved = resolveRequestAllowance("list", findArgs?.allowance);
    const settings = resolved.settings;
    const allowance =
      resolved.status === "ok"
        ? (resolved.requested ?? settings.defaultTokens)
        : settings.defaultTokens;
    const validationFailure = getFindValidationFailure(
      findCliMeasure,
      settings.ceilingTokens,
      settings.defaultTokens,
      undefined,
      resolved.status === "invalid"
        ? "usage_error: Allowance must be a positive whole number."
        : resolved.status === "over_ceiling"
          ? `usage_error: Allowance exceeds the configured ceiling; configured ceiling is ${settings.ceilingTokens} tokens.`
          : undefined,
    );
    const outcome =
      resolved.status !== "ok"
        ? {
            status:
              resolved.status === "over_ceiling"
                ? ("output_limit_exceeded" as const)
                : ("usage_error" as const),
            content: getFindValidationText(validationFailure),
            isError: true,
          }
        : allowance < validationFailure.tokens
          ? {
              status: "usage_error" as const,
              content: getFindValidationText(validationFailure),
              isError: true,
            }
          : await discoverFindBatch(requestArgs, context, {
              allowance,
              validationAllowance: settings.defaultTokens,
              maximumAllowance: settings.ceilingTokens,
              increaseHint:
                settings.ceilingTokens > allowance
                  ? ` A larger allowance up to ${settings.ceilingTokens} tokens is supported.`
                  : "",
              measure: findCliMeasure,
              metadataBytes: (text, isError) =>
                Buffer.byteLength(findCliResponse(text, isError), "utf8"),
              hasRtk: await isRtkAvailable(),
              backend: async (operand, predicates) => {
                const result = await executeRtkCommand(
                  "find",
                  [operand, ...predicates],
                  context,
                );
                if (!result.available) throw new Error("RTK unavailable");
                return { stdout: result.stdout, exitCode: result.exitCode };
              },
            });
    if (outcome.status === "partial_result" || outcome.isError)
      process.exitCode = 1;
    console.log(findCliResponse(outcome.content, outcome.isError).trimEnd());
    return;
  }
  if (
    command === "git" &&
    rawArgs[0] === "diff" &&
    !rawArgs.some((arg) =>
      ["--name-only", "--name-status", "--stat"].includes(arg),
    )
  ) {
    const outcome = await executeGitDiffPatchOutcome(
      requestArgs,
      context,
      gitAllowance,
    );
    emitGitResponse(
      outcome.status === "failure" ? outcome.message : outcome.content,
      gitAllowance,
      outcome.status === "failure" ? outcome.exitCode : 0,
      outcome.status === "success" && outcome.truncated,
    );
    return;
  }
  let result;
  try {
    result = await executeRtkCommand(command, requestArgs, context);
  } catch (error: unknown) {
    if (command === "git") {
      emitGitResponse(
        rawArgs[0] === "status"
          ? "RTK listing failed before output could be checked."
          : formatProxyFailure(error),
        gitAllowance,
        1,
      );
      return;
    }
    console.error(
      command === "git" && rawArgs[0] === "status"
        ? "RTK listing failed before output could be checked."
        : formatProxyFailure(error),
    );
    process.exitCode = 1;
    return;
  }

  if (!result.available) {
    if (command === "git") {
      emitGitResponse(
        "The `rtk` executable was not found. Install RTK with the `rtk-ai` package, then retry the command.",
        gitAllowance,
        1,
      );
      return;
    }
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

  if (command === "git" && rawArgs[0] === "status") {
    const outcome = await renderGitStatusOutcome(
      result,
      requestArgs,
      context,
      gitAllowance,
    );
    emitGitResponse(
      outcome.status === "failure" ? outcome.message : outcome.content,
      gitAllowance,
      outcome.status === "failure" ? outcome.exitCode : 0,
      outcome.status === "success" && outcome.truncated,
    );
    return;
  }

  if (command === "git" && rawArgs[0] === "branch") {
    const outcome = renderGitBranchOutcome(result, gitAllowance);
    emitGitResponse(
      outcome.status === "failure" ? outcome.message : outcome.content,
      gitAllowance,
      outcome.status === "failure" ? outcome.exitCode : 0,
      outcome.status === "success" && outcome.truncated,
    );
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
    const outcome = await renderGitBlobOutcome(
      result,
      selector,
      context,
      gitAllowance,
    );
    emitGitResponse(
      outcome.status === "failure" ? outcome.message : outcome.content,
      gitAllowance,
      outcome.status === "failure" ? outcome.exitCode : 0,
      outcome.status === "success" && outcome.truncated,
    );
    return;
  }

  if (command === "git" && isGitHistoryPatchRequest(rawArgs)) {
    const outcome = await executeGitHistoryPatchOutcome(
      requestArgs,
      context,
      gitAllowance,
    );
    emitGitResponse(
      outcome.status === "failure" ? outcome.message : outcome.content,
      gitAllowance,
      outcome.status === "failure" ? outcome.exitCode : 0,
      outcome.status === "success" && outcome.truncated,
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
    const outcome = await renderGitHistoryOutcome(
      result,
      requestArgs,
      context,
      gitAllowance,
    );
    emitGitResponse(
      outcome.status === "failure" ? outcome.message : outcome.content,
      gitAllowance,
      outcome.status === "failure" ? outcome.exitCode : 0,
      outcome.status === "success" && outcome.truncated,
    );
    return;
  }

  if (command === "git" && rawArgs[0] === "diff") {
    const outcome = await renderGitDiffOutcome(
      result,
      requestArgs,
      context,
      gitAllowance,
    );
    emitGitResponse(
      outcome.status === "failure" ? outcome.message : outcome.content,
      gitAllowance,
      outcome.status === "failure" ? outcome.exitCode : 0,
      outcome.status === "success" && outcome.truncated,
    );
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
