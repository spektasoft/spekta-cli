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

  if (args[0] === "status") {
    const separator = args.indexOf("--");
    const flags = args.slice(1, separator < 0 ? args.length : separator);
    const version = flags
      .filter((flag) => flag.startsWith("--porcelain"))
      .at(-1);
    const untracked = flags
      .filter((flag) => flag.startsWith("--untracked-files="))
      .at(-1);
    return {
      args: [
        "proxy",
        "git",
        "--no-pager",
        "--literal-pathspecs",
        "-c",
        "status.relativePaths=true",
        "status",
        version === "--porcelain=v2" ? version : "--porcelain=v1",
        "-z",
        ...(flags.includes("--branch") || flags.includes("-b")
          ? ["--branch"]
          : []),
        untracked === "--untracked-files=no"
          ? untracked
          : "--untracked-files=all",
        "--",
        ...(separator < 0
          ? ["."]
          : args.slice(separator + 1).length
            ? args.slice(separator + 1)
            : ["."]),
      ],
      env: { ...env, GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat", PAGER: "cat" },
      cwd: workspaceCwd ?? process.cwd(),
    };
  }

  if (args[0] === "branch") {
    const flags = args.slice(1);
    const list = flags
      .map((flag) => (flag === "--verbose" || flag === "-v" ? undefined : flag))
      .filter((flag): flag is string => flag !== undefined);
    const optionEnd = list.findIndex(
      (flag) => flag === "--" || !flag.startsWith("-"),
    );
    const insertion = optionEnd < 0 ? list.length : optionEnd;
    return {
      args: [
        "proxy",
        "git",
        "--no-pager",
        "branch",
        "--no-color",
        ...list.slice(0, insertion),
        "--format=%(if)%(HEAD)%(then)* %(end)%(refname:short)",
        ...list.slice(insertion),
      ],
      env: { ...env, GIT_PAGER: "cat", PAGER: "cat" },
      cwd: workspaceCwd ?? process.cwd(),
    };
  }

  env.GIT_PAGER = "cat";
  env.PAGER = "cat";
  if (args[0] === "diff") env.GIT_OPTIONAL_LOCKS = "0";
  const history = ["log", "show", "diff"].includes(args[0]);
  let commandArgs = args.slice(1);
  if (["log", "show"].includes(args[0])) {
    const separator = commandArgs.indexOf("--");
    const flags = commandArgs.slice(
      0,
      separator < 0 ? commandArgs.length : separator,
    );
    const summary = flags.some((flag) =>
      ["--stat", "--name-only", "--name-status"].includes(flag),
    );
    if (summary) {
      const selected = flags.filter(
        (flag) => !["--stat", "--name-only", "--name-status"].includes(flag),
      );
      const paths = separator < 0 ? [] : commandArgs.slice(separator + 1);
      commandArgs = [
        ...selected,
        "--format=",
        "--name-status",
        "-z",
        "--",
        ...(paths.length ? paths : ["."]),
      ];
    }
  }
  if (args[0] === "diff") {
    const separator = commandArgs.indexOf("--");
    const flags = commandArgs.slice(
      0,
      separator < 0 ? commandArgs.length : separator,
    );
    const summary = flags.some((flag) =>
      ["--name-only", "--name-status", "--stat"].includes(flag),
    );
    if (summary) {
      const revisions = flags.filter(
        (flag) => !["--name-only", "--name-status", "--stat"].includes(flag),
      );
      const paths = separator < 0 ? [] : commandArgs.slice(separator + 1);
      const mode = flags.includes("--stat") ? ["--numstat"] : ["--name-status"];
      commandArgs = [
        ...revisions,
        ...mode,
        "-z",
        "-M",
        "--",
        ...(paths.length ? paths : ["."]),
      ];
    }
  }
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
      ...commandArgs,
      ...(history && !commandArgs.includes("--") ? ["--"] : []),
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
