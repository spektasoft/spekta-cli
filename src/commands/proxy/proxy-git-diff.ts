import path from "node:path";
import { resolveWorkspace, type WorkspaceContext } from "../../utils/workspace";
import { getTokenCount } from "../../utils/read-utils";
import { formatProxyOutput } from "./proxy-output";
import { redactSecrets } from "./proxy-secret-redaction";
import { findRepositoryRoot } from "./proxy-git-policy";
import { isEligibleGitPath } from "./proxy-git-status";
import type { DiscoveryRenderOutcome } from "./proxy-ls-render";

const LIMIT = 1000;

/** Render normalized NUL-delimited Git summary records after filtering both path names. */
export async function renderGitDiffOutcome(
  result: { stdout: string; exitCode: number },
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
  const flags = args.slice(
    1,
    args.indexOf("--") < 0 ? args.length : args.indexOf("--"),
  );
  const mode = flags.includes("--stat")
    ? "stat"
    : flags.includes("--name-status")
      ? "name-status"
      : flags.includes("--name-only")
        ? "name-only"
        : undefined;
  if (!mode)
    return failure("Git diff summary rejected: unsupported output format.");
  try {
    const workspace = await resolveWorkspace(context);
    const root = findRepositoryRoot(context);
    const fields = result.stdout === "" ? [] : result.stdout.split("\0");
    if (fields.length && fields.pop() !== "")
      return failure(
        "Git diff summary rejected: entries could not be attributed reliably.",
      );
    const entries: Array<{
      status: string;
      old?: string;
      name: string;
      added?: string;
      deleted?: string;
    }> = [];
    for (let index = 0; index < fields.length;) {
      const field = fields[index++];
      let status: string;
      let old: string | undefined;
      let name: string;
      let added: string | undefined;
      let deleted: string | undefined;
      if (mode === "stat") {
        const parts = field.split("\t");
        if (
          parts.length < 3 ||
          !/^\d+|-$/.test(parts[0]) ||
          !/^\d+|-$/.test(parts[1])
        )
          return failure(
            "Git diff summary rejected: entries could not be attributed reliably.",
          );
        [added, deleted] = parts;
        name = parts.slice(2).join("\t");
        status = "M";
        if (!name) {
          old = fields[index++];
          name = fields[index++];
          if (!old || !name)
            return failure(
              "Git diff summary rejected: incomplete rename record.",
            );
          status = "R";
        }
      } else {
        status = field;
        if (!/^(A|C|D|M|R|T|U|X|B)(\d{1,3})?$/.test(status))
          return failure(
            "Git diff summary rejected: entries could not be attributed reliably.",
          );
        if (status.startsWith("R") || status.startsWith("C")) {
          old = fields[index++];
          name = fields[index++];
          if (old === undefined || name === undefined)
            return failure(
              "Git diff summary rejected: incomplete rename record.",
            );
        } else {
          name = fields[index++];
          if (name === undefined)
            return failure(
              "Git diff summary rejected: incomplete path record.",
            );
        }
      }
      const safePath = (value: string): boolean =>
        value !== "" &&
        !path.isAbsolute(value) &&
        !value
          .split("/")
          .some((part) => part === ".." || part === "." || part === "");
      if (!safePath(name) || (old !== undefined && !safePath(old)))
        return failure(
          "Git diff summary rejected: entries could not be attributed reliably.",
        );
      const relative = (value: string) =>
        path.relative(workspace.root, path.resolve(root, value));
      const current = relative(name);
      const previous = old === undefined ? undefined : relative(old);
      if (
        !(await isEligibleGitPath(current, workspace)) ||
        (previous !== undefined &&
          !(await isEligibleGitPath(previous, workspace)))
      )
        continue;
      entries.push({
        status,
        ...(previous === undefined ? {} : { old: previous }),
        name: current,
        ...(added === undefined ? {} : { added, deleted }),
      });
    }
    const lines = entries.map((entry) => {
      const display =
        entry.old === undefined ? entry.name : `${entry.old} -> ${entry.name}`;
      if (mode === "name-only") return JSON.stringify(display);
      if (mode === "name-status")
        return `${entry.status}\t${JSON.stringify(display)}`;
      return `${entry.added}\t${entry.deleted}\t${JSON.stringify(display)}`;
    });
    if (mode === "stat")
      lines.push(
        `${entries.length} eligible file${entries.length === 1 ? "" : "s"} changed`,
      );
    const output = redactSecrets(lines.join("\n"));
    const rendered = formatProxyOutput("git", output);
    if (getTokenCount(`${rendered}\n`) <= LIMIT)
      return { status: "success", content: output, truncated: false };
    return failure("Git diff summary too large. Choose a narrower path.");
  } catch {
    return failure(
      "Git diff summary rejected: entries could not be attributed reliably.",
    );
  }
}
