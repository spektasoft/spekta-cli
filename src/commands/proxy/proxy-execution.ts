import { execa } from "execa";
import path from "path";
import type { WorkspaceContext } from "../../utils/workspace";

export type RtkExecutionResult =
  | {
      available: false;
    }
  | {
      available: true;
      stdout: string;
      stderr: string;
      exitCode: number;
    };

export function prepareRtkInvocation(
  command: string,
  args: string[],
  context?: WorkspaceContext,
): {
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
} {
  const controlledGit =
    command === "git" &&
    ["status", "log", "show", "diff", "branch"].includes(args[0]);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: "1",
    TERM: "dumb",
  };
  const workspaceCwd =
    context?.root === undefined ? undefined : path.resolve(context.root);
  if (command === "find") {
    const hasExplicitRoot = args.length > 0 && !args[0].startsWith("-");

    return {
      args: [
        "proxy",
        "find",
        "-P",
        ...(hasExplicitRoot ? args : [".", ...args]),
      ],
      env,
      cwd: workspaceCwd ?? process.cwd(),
    };
  }

  if (command === "ls") {
    // Raw one-entry-per-line output with -b escapes lets Spekta attribute and
    // filter each entry; decorated RTK listings are never parsed.
    return {
      args: ["proxy", "ls", "-1Ab", "--", args[0] ?? "."],
      env: { ...env, LC_ALL: "C" },
      cwd: workspaceCwd ?? process.cwd(),
    };
  }

  if (!controlledGit) {
    return {
      args: [command, ...args],
      env,
      ...(workspaceCwd === undefined ? {} : { cwd: workspaceCwd }),
    };
  }

  env.GIT_PAGER = "cat";
  env.PAGER = "cat";
  if (args[0] === "diff") env.GIT_OPTIONAL_LOCKS = "0";
  const history = ["log", "show", "diff"].includes(args[0]);
  return {
    args: [
      "proxy",
      "git",
      "--no-pager",
      "--literal-pathspecs",
      ...(args[0] === "diff" ? ["-c", "diff.autoRefreshIndex=false"] : []),
      args[0],
      ...(history ? ["--no-ext-diff", "--no-textconv"] : []),
      ...(args[0] === "diff" ? ["--submodule=short"] : []),
      ...args.slice(1),
      ...(history && !args.includes("--") ? ["--"] : []),
    ],
    env,
    cwd: workspaceCwd ?? process.cwd(),
  };
}

export async function executeRtkCommand(
  command: string,
  args: string[],
  context?: WorkspaceContext,
): Promise<RtkExecutionResult> {
  const invocation = prepareRtkInvocation(command, args, context);
  try {
    const result = await execa("rtk", invocation.args, {
      reject: false,
      env: invocation.env,
      ...(invocation.cwd === undefined ? {} : { cwd: invocation.cwd }),
    });

    if (result.failed && result.exitCode === undefined) {
      throw result instanceof Error
        ? result
        : Object.assign(
            new Error(result.shortMessage ?? "Failed to execute RTK"),
            result,
          );
    }

    return {
      available: true,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 0,
    };
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";

    if (code === "ENOENT" || code === "ENOTFOUND") {
      return { available: false };
    }

    throw error;
  }
}

export async function isRtkAvailable(): Promise<boolean> {
  try {
    await execa("rtk", ["--version"]);
    return true;
  } catch {
    return false;
  }
}
