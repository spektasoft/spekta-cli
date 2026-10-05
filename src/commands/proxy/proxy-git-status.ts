import { findRepositoryRoot } from "./proxy-git-policy";
import path from "node:path";
import fs from "fs-extra";
import {
  resolveWorkspace,
  resolveWorkspaceMutationTarget,
  type WorkspaceContext,
} from "../../utils/workspace";
import { RESTRICTED_FILES, validateReadPathAccess } from "../../utils/security";
import { assertPathNotIgnored } from "../../utils/path-ignore";
import { getTokenCount } from "../../utils/read-utils";
import { formatProxyOutput, truncateOutput } from "./proxy-output";
import { redactSecrets } from "./proxy-secret-redaction";
import type { DiscoveryRenderOutcome } from "./proxy-ls-render";

/** Status is collected as NUL-delimited records, never as decorated RTK output. */
export async function renderGitStatusOutcome(
  result: { stdout: string; stderr: string; exitCode: number },
  args: string[],
  context?: WorkspaceContext,
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
    const lines: string[] = [];
    const eligible = async (name: string): Promise<boolean> => {
      try {
        const target = await resolveWorkspaceMutationTarget(
          name,
          workspace,
          true,
        );
        for (const candidate of new Set([
          name,
          path.relative(workspace.canonicalRoot, target.canonicalPath),
        ])) {
          if (
            candidate.split("/").some((part) => RESTRICTED_FILES.includes(part))
          )
            return false;
          await assertPathNotIgnored(
            candidate,
            candidate,
            { gitNoIndex: true },
            workspace.canonicalRoot,
          );
        }
        if (await fs.pathExists(target.absolutePath))
          await validateReadPathAccess(name, workspace);
        return true;
      } catch {
        return false;
      }
    };
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
    const quote = (name: string): string =>
      JSON.stringify(name).replace(/`/g, "\\u0060");
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
      if (
        !(await eligible(name)) ||
        (source !== undefined && !(await eligible(source)))
      )
        continue;
      lines.push(
        prefix +
          (source === undefined
            ? quote(name)
            : `${quote(source)} -> ${quote(name)}`),
      );
    }
    // Directory aggregation and native long-format counts are deliberately replaced
    // by individual eligible entries. Branch metadata is budgeted with the entries.
    const output = redactSecrets(lines.join("\n"));
    let budget = 1000;
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
        ) - 1000;
      if (over <= 0) return { status: "success", ...truncated };
      budget -= over;
    }
    return failure("Git status too large. Choose a narrower path.");
  } catch {
    return failure(rejected);
  }
}
