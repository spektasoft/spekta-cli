import { execa } from "execa";

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
): {
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
} {
  const controlledGit =
    command === "git" && ["status", "log", "show", "diff"].includes(args[0]);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: "1",
    TERM: "dumb",
  };
  if (!controlledGit) return { args: [command, ...args], env };

  env.GIT_PAGER = "cat";
  env.PAGER = "cat";
  if (args[0] === "diff") env.GIT_OPTIONAL_LOCKS = "0";
  const history = args[0] !== "status";
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
    cwd: process.cwd(),
  };
}

export async function executeRtkCommand(
  command: string,
  args: string[],
): Promise<RtkExecutionResult> {
  const invocation = prepareRtkInvocation(command, args);
  try {
    const result = await execa("rtk", invocation.args, {
      reject: false,
      env: invocation.env,
      ...(invocation.cwd === undefined ? {} : { cwd: invocation.cwd }),
    });

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
