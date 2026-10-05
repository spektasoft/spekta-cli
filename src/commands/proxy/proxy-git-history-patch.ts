import path from "node:path";
import { execa } from "execa";
import { resolveWorkspace, type WorkspaceContext } from "../../utils/workspace";
import { getTokenCount } from "../../utils/read-utils";
import { formatProxyOutput, truncateOutput } from "./proxy-output";
import { redactSecrets } from "./proxy-secret-redaction";
import { findRepositoryRoot } from "./proxy-git-policy";
import { isEligibleGitPath } from "./proxy-git-status";
import { executeRtkCommand, isRtkAvailable } from "./proxy-execution";
import type { DiscoveryRenderOutcome } from "./proxy-ls-render";

const LIMIT = 1000;

export function isGitHistoryPatchRequest(args: string[]): boolean {
  if (!["log", "show"].includes(args[0])) return false;
  if (args[0] === "log")
    return args.some((arg) => ["-p", "--patch"].includes(arg));
  const separator = args.indexOf("--");
  const beforePaths = args.slice(0, separator < 0 ? args.length : separator);
  if (
    beforePaths.some((arg) =>
      ["--stat", "--name-only", "--name-status", "--no-patch"].includes(arg),
    )
  )
    return false;
  if (
    beforePaths.some(
      (arg, index) => index > 0 && !arg.startsWith("-") && arg.includes(":"),
    )
  )
    return false;
  return true;
}

/** Render log/show patches after discovering and filtering every historical path. */
export async function executeGitHistoryPatchOutcome(
  args: string[],
  context?: WorkspaceContext,
): Promise<DiscoveryRenderOutcome> {
  const fail = (message: string, exitCode = 1): DiscoveryRenderOutcome => ({
    status: "failure",
    message,
    exitCode,
  });
  if (!(await isRtkAvailable()))
    return fail("The `rtk` executable was not found.");
  const subcommand = args[0];
  const separator = args.indexOf("--");
  const flags = args.slice(1, separator < 0 ? args.length : separator);
  const paths = separator < 0 ? [] : args.slice(separator + 1);
  const patchFlags = new Set(["-p", "--patch"]);
  const options = flags.filter(
    (flag) => !patchFlags.has(flag) && flag !== "--no-patch",
  );
  // Commit messages, decorations, merges and other free-form envelopes cannot
  // be attributed to eligible files, so accept only the ordinary patch form.
  if (
    flags.some((flag) =>
      [
        "--stat",
        "--name-only",
        "--name-status",
        "--graph",
        "--all",
        "--decorate",
        "--decorate=short",
        "--decorate=full",
      ].includes(flag),
    )
  )
    return fail("Git history patch rejected: unsupported history output form.");
  if (
    subcommand === "log" &&
    !flags.includes("-p") &&
    !flags.includes("--patch")
  )
    return fail(
      "Git history patch rejected: request an ordinary -p or --patch form.",
    );
  const revisions: string[] = [];
  for (let i = 0; i < options.length; i++) {
    if (options[i] === "-n") {
      i++;
      continue;
    }
    if (options[i].startsWith("--max-count=")) continue;
    if (!options[i].startsWith("-") && options[i] !== "-")
      revisions.push(options[i]);
  }
  const countOption = options.some(
    (flag) => flag === "-n" || flag.startsWith("--max-count="),
  );
  const range = revisions.filter((revision) => revision.includes(".."));
  if (range.length > 1 || (range.length && revisions.length > 1))
    return fail("Git history patch rejected: unsupported revision range.");
  const countArgs: string[] = [];
  for (let i = 0; i < options.length; i++) {
    if (options[i] === "-n") countArgs.push("-n", options[++i]);
    else if (options[i].startsWith("--max-count=")) countArgs.push(options[i]);
  }
  const selection =
    subcommand === "show"
      ? [
          "log",
          "--format=%H",
          "-n",
          "1",
          ...(revisions.length ? revisions : ["HEAD"]),
          "--",
          ...(paths.length ? paths : ["."]),
        ]
      : [
          "log",
          "--format=%H",
          ...countArgs,
          ...revisions,
          "--",
          ...(paths.length ? paths : ["."]),
        ];
  if (!countOption && subcommand === "log") selection.push("-n", "10");
  let commits: { stdout: string; exitCode: number };
  try {
    const result = await execa("git", selection, {
      cwd: context?.root ?? process.cwd(),
      reject: false,
      env: {
        ...process.env,
        GIT_PAGER: "cat",
        PAGER: "cat",
        GIT_OPTIONAL_LOCKS: "0",
      },
    });
    commits = { stdout: result.stdout, exitCode: result.exitCode ?? 0 };
  } catch {
    return fail("Git history patch selection failed.");
  }
  if (commits.exitCode !== 0)
    return fail(
      `Git history patch selection failed with exit status ${commits.exitCode}.`,
      commits.exitCode,
    );
  const hashes = commits.stdout
    .split(/\r?\n/)
    .filter((hash) => /^[0-9a-f]{40,64}$/i.test(hash));
  const workspace = await resolveWorkspace(context);
  const root = findRepositoryRoot(context);
  const selectedCommits: Array<{ hash: string; paths: string[] }> = [];
  for (const hash of hashes) {
    const manifestResult = await execa(
      "git",
      [
        "show",
        "--format=",
        "--name-status",
        "-z",
        "-M",
        hash,
        "--",
        ...(paths.length ? paths : ["."]),
      ],
      {
        cwd: context?.root ?? process.cwd(),
        reject: false,
        env: {
          ...process.env,
          GIT_PAGER: "cat",
          PAGER: "cat",
          GIT_OPTIONAL_LOCKS: "0",
        },
      },
    );
    const manifest = {
      stdout: manifestResult.stdout,
      exitCode: manifestResult.exitCode ?? 0,
    };
    if (manifest.exitCode !== 0)
      return fail(
        `Git history patch manifest failed with exit status ${manifest.exitCode}.`,
        manifest.exitCode,
      );
    const fields = manifest.stdout ? manifest.stdout.split("\0") : [];
    if (fields.length && fields.pop() !== "")
      return fail(
        "Git history patch rejected: entries could not be attributed reliably.",
      );
    const accepted: string[] = [];
    for (let i = 0; i < fields.length;) {
      const status = fields[i++];
      const paired = /^[RC]\d{1,3}$/.test(status);
      if (!/^(?:[AMD]|[RC]\d{1,3})$/.test(status))
        return fail(
          "Git history patch rejected: unsupported patch representation.",
        );
      const names = paired ? [fields[i++], fields[i++]] : [fields[i++]];
      if (
        names.some(
          (name) =>
            !name ||
            path.isAbsolute(name) ||
            name
              .split("/")
              .some((part) => !part || part === "." || part === ".."),
        )
      )
        return fail(
          "Git history patch rejected: entries could not be attributed reliably.",
        );
      const eligible = await Promise.all(
        names.map((name) =>
          isEligibleGitPath(
            path.relative(workspace.root, path.resolve(root, name)),
            workspace,
          ),
        ),
      );
      if (eligible.every(Boolean)) accepted.push(...names);
    }
    if (accepted.length)
      selectedCommits.push({
        hash,
        paths: [
          ...new Set(
            accepted.map((name) =>
              path.relative(
                context?.root ?? process.cwd(),
                path.resolve(root, name),
              ),
            ),
          ),
        ],
      });
  }
  let patch = "";
  for (const commit of selectedCommits) {
    const result = await executeRtkCommand(
      "git",
      ["show", commit.hash, "--", ...commit.paths],
      context,
    );
    if (!result.available) return fail("The `rtk` executable was not found.");
    const stdout = result.stdout;
    if (result.exitCode !== 0)
      return fail(
        `RTK command failed with exit status ${result.exitCode}.`,
        result.exitCode,
      );
    if (
      /^GIT binary patch/m.test(stdout) ||
      /^Binary files .+ and .+ differ$/m.test(stdout) ||
      /^(?:old mode |new mode |Subproject commit |diff --(?:cc|combined) )|^@@@/m.test(
        stdout,
      )
    )
      return fail(
        "Git history patch rejected: unsupported patch representation.",
      );
    const patchStart = stdout.indexOf("diff --git ");
    if (stdout && patchStart < 0)
      return fail(
        "Git history patch rejected: unsupported patch representation.",
      );
    const filePatch = patchStart < 0 ? "" : stdout.slice(patchStart);
    patch += `${filePatch}${filePatch && !filePatch.endsWith("\n") ? "\n" : ""}`;
  }
  const condensed = truncateOutput(redactSecrets(patch), 900);
  if (
    getTokenCount(
      `${formatProxyOutput("git", condensed.content, { truncated: condensed.truncated })}\n`,
    ) > LIMIT
  )
    return fail(
      "Git history patch too large. Choose a narrower path, revision range, or count.",
    );
  return {
    status: "success",
    content: condensed.content,
    truncated: condensed.truncated,
  };
}
