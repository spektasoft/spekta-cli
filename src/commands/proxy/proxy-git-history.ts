import path from "node:path";
import { resolveWorkspace, type WorkspaceContext } from "../../utils/workspace";
import { getTokenCount } from "../../utils/read-utils";
import { formatProxyOutput } from "./proxy-output";
import { redactSecrets } from "./proxy-secret-redaction";
import { findRepositoryRoot } from "./proxy-git-policy";
import { isEligibleGitPath } from "./proxy-git-status";
import type { DiscoveryRenderOutcome } from "./proxy-ls-render";

const LIMIT = 1000;

/** Render log/show summaries from NUL-delimited name-status records. */
export async function renderGitHistoryOutcome(
  result: { stdout: string; exitCode: number },
  args: string[],
  context?: WorkspaceContext,
): Promise<DiscoveryRenderOutcome> {
  const fail = (message: string, exitCode = 1): DiscoveryRenderOutcome => ({
    status: "failure",
    message,
    exitCode,
  });
  if (result.exitCode !== 0)
    return fail(
      `RTK command failed with exit status ${result.exitCode}.`,
      result.exitCode,
    );

  const flags = args.slice(
    1,
    args.indexOf("--") < 0 ? args.length : args.indexOf("--"),
  );
  if (
    !flags.some((flag) =>
      ["--stat", "--name-only", "--name-status"].includes(flag),
    )
  )
    return fail(
      "Git history summary rejected: request a supported --stat, --name-only, or --name-status form.",
    );
  const mode = flags.includes("--stat")
    ? "stat"
    : flags.includes("--name-status")
      ? "status"
      : "name";
  const unsafeFreeText = flags.some((flag) =>
    [
      "--oneline",
      "--graph",
      "--decorate",
      "--decorate=short",
      "--decorate=full",
      "--all",
    ].includes(flag),
  );
  if (unsafeFreeText)
    return fail(
      "Git history summary rejected: commit messages and graph metadata are unsupported.",
    );

  try {
    const workspace = await resolveWorkspace(context);
    const root = findRepositoryRoot(context);
    const fields = result.stdout === "" ? [] : result.stdout.split("\0");
    if (fields.length && fields.pop() !== "")
      return fail(
        "Git history summary rejected: entries could not be attributed reliably.",
      );
    const lines: string[] = [];
    let eligibleCount = 0;
    for (let i = 0; i < fields.length;) {
      const status = fields[i++];
      if (!/^(?:A|C|D|M|R|T|U|X|B)(?:\d{1,3})?$/.test(status))
        return fail(
          "Git history summary rejected: entries could not be attributed reliably.",
        );
      const paired = status.startsWith("R") || status.startsWith("C");
      const first = fields[i++];
      const second = paired ? fields[i++] : undefined;
      if (first === undefined || (paired && second === undefined))
        return fail("Git history summary rejected: incomplete path record.");
      const old = paired ? first : undefined;
      const name = paired ? second! : first;
      const safe = (value: string) =>
        value !== "" &&
        !path.isAbsolute(value) &&
        !value
          .split("/")
          .some((part) => !part || part === "." || part === "..");
      if (!safe(name) || (old !== undefined && !safe(old)))
        return fail(
          "Git history summary rejected: entries could not be attributed reliably.",
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
      eligibleCount++;
      const shown =
        previous === undefined ? current : `${previous} -> ${current}`;
      lines.push(
        mode === "name"
          ? JSON.stringify(shown)
          : `${status}\t${JSON.stringify(shown)}`,
      );
    }
    if (mode === "stat")
      lines.push(
        `${eligibleCount} eligible file${eligibleCount === 1 ? "" : "s"} changed`,
      );
    const content = redactSecrets(lines.join("\n"));
    if (getTokenCount(`${formatProxyOutput("git", content)}\n`) > LIMIT)
      return fail(
        "Git history summary too large. Choose a narrower path or revision range.",
      );
    return { status: "success", content, truncated: false };
  } catch {
    return fail(
      "Git history summary rejected: entries could not be attributed reliably.",
    );
  }
}
