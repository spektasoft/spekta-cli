import { findRepositoryRoot } from "./proxy-git-policy";
import path from "node:path";
import fs from "fs-extra";
import {
  resolveWorkspace,
  resolveWorkspaceMutationTarget,
  type WorkspaceContext,
} from "../../utils/workspace";
import { RESTRICTED_FILES, validateReadPathAccess } from "../../utils/security";
import {
  assertPathNotIgnored,
  getIgnoreRuleMatches,
} from "../../utils/path-ignore";
import { getTokenCount } from "../../utils/read-utils";
import { formatProxyOutput, truncateOutput } from "./proxy-output";
import { redactSecrets } from "./proxy-secret-redaction";
import type { DiscoveryRenderOutcome } from "./proxy-render-outcome";

/** Status is collected as NUL-delimited records, never as decorated RTK output. */
export async function renderGitStatusOutcome(
  result: { stdout: string; stderr: string; exitCode: number },
  args: string[],
  context?: WorkspaceContext,
  allowance = 1000,
): Promise<DiscoveryRenderOutcome> {
  const failure = (message: string, exitCode = 1): DiscoveryRenderOutcome => ({
    status: "failure",
    message,
    exitCode,
  });
  if (result.exitCode !== 0)
    return failure(
      `RTK command failed with exit status ${result.exitCode}.`,
      result.exitCode,
    );
  const rejected =
    "Git status rejected: entries could not be attributed reliably.";
  try {
    const workspace = await resolveWorkspace(context);
    const repositoryRoot = findRepositoryRoot(context);
    const separator = args.indexOf("--");
    const flags = args.slice(1, separator < 0 ? args.length : separator);
    const v2 =
      flags.filter((flag) => flag.startsWith("--porcelain")).at(-1) ===
      "--porcelain=v2";
    const records = result.stdout === "" ? [] : result.stdout.split("\0");
    if (records.length && records.pop() !== "") return failure(rejected);
    const lines: Array<
      string | { prefix: string; name: string; source?: string }
    > = [];
    const unsafeText = (value: string): boolean =>
      Array.from(value).some(
        (char) =>
          char.charCodeAt(0) < 32 ||
          char.charCodeAt(0) === 127 ||
          char === "\ufffd",
      );
    const safeName = (name: string): boolean =>
      name !== "" &&
      !path.isAbsolute(name) &&
      !name
        .split("/")
        .some((part) => part === ".." || part === "." || part === "") &&
      !unsafeText(name) &&
      !name.includes("\\");
    // Git paths use forward slashes regardless of the host platform.
    const quote = (name: string): string =>
      JSON.stringify(name.split(path.sep).join("/")).replace(/`/g, "\\u0060");
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      if (
        (!v2 && record.startsWith("## ")) ||
        (v2 && record.startsWith("# branch."))
      ) {
        if (!flags.includes("--branch") && !flags.includes("-b"))
          return failure(rejected);
        if (unsafeText(record) || record.includes("`"))
          return failure(rejected);
        if (!v2 || /^# branch\.(oid|head) /.test(record)) lines.push(record);
        continue;
      }
      let name: string;
      let rename = false;
      let prefix: string;
      if (v2) {
        const match = /^(1|2|u) [ .MADRCUT?!]{2} /.exec(record);
        if (record.startsWith("? ")) {
          prefix = "? ";
          name = record.slice(2);
        } else {
          if (!match) return failure(rejected);
          const fields = record.startsWith("1 ")
            ? 8
            : record.startsWith("2 ")
              ? 9
              : 10;
          const parts = record.split(" ");
          if (parts.length <= fields) return failure(rejected);
          prefix = parts.slice(0, fields).join(" ") + " ";
          name = parts.slice(fields).join(" ");
          rename = record.startsWith("2 ");
        }
      } else {
        if (!/^[ MADRCUT?!]{2} /.test(record)) return failure(rejected);
        prefix = record.slice(0, 3);
        name = record.slice(3);
        rename = /[RC]/.test(prefix);
      }
      let source = rename ? records[++index] : undefined;
      if (
        !safeName(name) ||
        (rename && (source === undefined || !safeName(source)))
      )
        return failure(rejected);
      name = path.relative(workspace.root, path.resolve(repositoryRoot, name));
      if (source !== undefined)
        source = path.relative(
          workspace.root,
          path.resolve(repositoryRoot, source),
        );
      lines.push({ prefix, name, source });
    }
    const eligiblePaths = await areEligibleGitPaths(
      lines.flatMap((line) =>
        typeof line === "string"
          ? []
          : line.source === undefined
            ? [line.name]
            : [line.name, line.source],
      ),
      workspace,
    );
    const renderedLines = lines.flatMap((line) => {
      if (typeof line === "string") return [line];
      if (
        !eligiblePaths.get(line.name) ||
        (line.source !== undefined && !eligiblePaths.get(line.source))
      )
        return [];
      return [
        line.prefix +
          (line.source === undefined
            ? quote(line.name)
            : `${quote(line.source)} -> ${quote(line.name)}`),
      ];
    });
    // Directory aggregation and native long-format counts are deliberately replaced
    // by individual eligible entries. Branch metadata is budgeted with the entries.
    const output = redactSecrets(
      [
        "Eligible native Git status; eligible untracked entries may appear, while native ignored untracked entries do not.",
        ...renderedLines,
      ].join("\n"),
    );
    let budget = allowance;
    while (budget > 0) {
      const truncated = truncateOutput(output, budget);
      const over =
        Math.max(
          getTokenCount(
            formatProxyOutput("git", truncated.content, {
              truncated: truncated.truncated,
            }) + "\n",
          ),
          getTokenCount(
            JSON.stringify({
              isError: false,
              content: [{ type: "text", text: truncated.content }],
            }),
          ),
        ) - allowance;
      if (over <= 0) return { status: "success", ...truncated };
      budget -= over;
    }
    return failure("Git status too large. Choose a narrower path.");
  } catch {
    return failure(rejected);
  }
}

/** Batch Git-ignore checks for the records in one native status response. */
async function areEligibleGitPaths(
  names: readonly string[],
  workspace: Awaited<ReturnType<typeof resolveWorkspace>>,
): Promise<ReadonlyMap<string, boolean>> {
  const eligibility = new Map<string, boolean>();
  const candidatesByName = new Map<string, string[]>();
  const targetsByName = new Map<
    string,
    Awaited<ReturnType<typeof resolveWorkspaceMutationTarget>>
  >();

  await Promise.all(
    [...new Set(names)].map(async (name) => {
      try {
        const target = await resolveWorkspaceMutationTarget(
          name,
          workspace,
          true,
        );
        const candidates = [
          ...new Set([
            name,
            path.relative(workspace.canonicalRoot, target.canonicalPath),
          ]),
        ];
        if (
          candidates.some((candidate) =>
            candidate
              .split("/")
              .some((part) => RESTRICTED_FILES.includes(part)),
          )
        ) {
          eligibility.set(name, false);
          return;
        }
        candidatesByName.set(name, candidates);
        targetsByName.set(name, target);
      } catch {
        eligibility.set(name, false);
      }
    }),
  );

  const allCandidates = [...candidatesByName.values()].flat();
  let ignoreMatches: ReadonlyMap<string, "spekta" | "git" | null>;
  try {
    ignoreMatches = await getIgnoreRuleMatches(
      allCandidates,
      true,
      workspace.canonicalRoot,
    );
  } catch {
    for (const name of candidatesByName.keys()) eligibility.set(name, false);
    return eligibility;
  }

  await Promise.all(
    [...candidatesByName].map(async ([name, candidates]) => {
      if (
        candidates.some(
          (candidate) =>
            ignoreMatches.get(candidate.split(path.sep).join("/")) !== null,
        )
      ) {
        eligibility.set(name, false);
        return;
      }
      const target = targetsByName.get(name);
      try {
        if (target && (await fs.pathExists(target.absolutePath)))
          await validateReadPathAccess(name, workspace, {
            gitIgnoreAlreadyChecked: true,
          });
        eligibility.set(name, true);
      } catch {
        eligibility.set(name, false);
      }
    }),
  );
  return eligibility;
}

/** Shared name and content disclosure check for Git paths, including historical paths. */
export async function isEligibleGitPath(
  name: string,
  workspace?: Awaited<ReturnType<typeof resolveWorkspace>>,
): Promise<boolean> {
  try {
    const resolved = workspace ?? (await resolveWorkspace());
    const target = await resolveWorkspaceMutationTarget(name, resolved, true);
    for (const candidate of new Set([
      name,
      path.relative(resolved.canonicalRoot, target.canonicalPath),
    ])) {
      if (candidate.split("/").some((part) => RESTRICTED_FILES.includes(part)))
        return false;
      await assertPathNotIgnored(
        candidate,
        candidate,
        { gitNoIndex: true },
        resolved.canonicalRoot,
      );
    }
    if (await fs.pathExists(target.absolutePath))
      await validateReadPathAccess(name, resolved);
    return true;
  } catch {
    return false;
  }
}
