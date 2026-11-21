import { createHash } from "node:crypto";
import path from "node:path";
import { executeRtkCommand } from "./proxy/proxy-execution";
import { isEligibleGitPath } from "./proxy/proxy-git-status";
import { resolveWorkspace, type WorkspaceContext } from "../utils/workspace";
import { getTokenCount } from "../utils/read-utils";
import { resolveRequestAllowance } from "../core/config/allowance";
import { formatProxyOutput } from "./proxy/proxy-output";
import { redactSecrets } from "./proxy/proxy-secret-redaction";

export type WorkspaceReviewSource = "all" | "staged" | "unstaged";

export type WorkspaceReviewOutcome =
  | { status: "success"; content: string }
  | { status: "incomplete"; content: string }
  | { status: "failure"; message: string };

export interface WorkspaceReviewRequest {
  source?: WorkspaceReviewSource;
  continuation?: string;
  allowance: number;
  ceiling?: number;
}

interface ReviewSection {
  source: "staged" | "unstaged";
  paths: string[];
  kind: "text" | "binary";
  rawContent: string;
  lines: string[];
}

interface ReviewCursor {
  section: number;
  line: number;
}

interface ReviewChunk {
  section: number;
  startLine: number;
  lines: string[];
}

const RESTART =
  "Workspace review state changed; restart the review without a continuation.";

async function collectSections(
  sources: Array<"staged" | "unstaged">,
  context?: WorkspaceContext,
): Promise<ReviewSection[]> {
  const workspace = await resolveWorkspace(context);
  const sections: ReviewSection[] = [];
  for (const source of sources) {
    const diffArgs = source === "staged" ? ["--cached"] : [];
    const manifest = await executeRtkCommand(
      "git",
      ["diff", ...diffArgs, "--name-only", "-z", "--"],
      context,
    );
    if (!manifest.available)
      throw new Error("The `rtk` executable was not found.");
    if (manifest.exitCode !== 0)
      throw new Error("Git workspace review failed.");
    const records = manifest.stdout === "" ? [] : manifest.stdout.split("\0");
    if (records.length && records.pop() !== "")
      throw new Error("Git workspace review failed.");
    const changes: string[][] = [];
    for (let index = 0; index < records.length;) {
      const status = records[index++];
      const paired = /^[RC]\d{1,3}$/.test(status);
      if (
        (!/^[AMDCTUXB]$/.test(status) && !paired) ||
        records[index] === undefined
      )
        throw new Error("Git workspace review failed.");
      const names = paired
        ? [records[index++], records[index++]]
        : [records[index++]];
      if (names.some((name) => name === undefined))
        throw new Error("Git workspace review failed.");
      changes.push(names);
    }
    const seen = new Set<string>();
    for (const names of changes) {
      if (
        names.some(
          (name) =>
            !name ||
            path.isAbsolute(name) ||
            path.win32.isAbsolute(name) ||
            name.includes("\\") ||
            Array.from(name).some(
              (char) =>
                char.charCodeAt(0) < 32 ||
                char.charCodeAt(0) === 127 ||
                char === "\ufffd",
            ) ||
            name
              .split("/")
              .some((part) => !part || part === "." || part === ".."),
        )
      )
        throw new Error("Git workspace review failed.");
      const relativeNames = names.map((name) =>
        path.relative(workspace.root, path.resolve(workspace.root, name)),
      );
      const eligible = await Promise.all(
        relativeNames.map((name) => isEligibleGitPath(name, workspace)),
      );
      if (!eligible.every(Boolean)) continue;
      const key = `${source}\0${JSON.stringify(names)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const patch = await executeRtkCommand(
        "git",
        [
          "diff",
          ...diffArgs,
          "-M",
          "--binary",
          "--no-ext-diff",
          "--no-textconv",
          "--no-color",
          "--",
          ...names,
        ],
        context,
      );
      if (!patch.available)
        throw new Error("The `rtk` executable was not found.");
      if (patch.exitCode !== 0) throw new Error("Git workspace review failed.");
      if (!patch.stdout || !patch.stdout.startsWith("diff --git "))
        throw new Error("Git workspace review failed.");
      if ((patch.stdout.match(/^diff --git /gm) ?? []).length !== 1)
        throw new Error("Git workspace review failed.");
      const binary =
        /^GIT binary patch(?:\s|$)/m.test(patch.stdout) ||
        /^Binary files .+ differ$/m.test(patch.stdout);
      let rawContent = patch.stdout;
      if (binary && /^Binary files .+ differ$/m.test(patch.stdout)) {
        const identity = await executeRtkCommand(
          "git",
          ["diff", ...diffArgs, "--raw", "--full-index", "-z", "--", ...names],
          context,
        );
        if (!identity.available || identity.exitCode !== 0 || !identity.stdout)
          throw new Error("Git workspace review failed.");
        rawContent += identity.stdout;
      }
      sections.push({
        source,
        paths: names,
        kind: binary ? "binary" : "text",
        rawContent,
        lines: binary
          ? ["Binary change content is not displayed."]
          : splitPatchLines(redactSecrets(patch.stdout)),
      });
    }
  }
  return sections;
}

function splitPatchLines(value: string): string[] {
  return value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function continuation(version: string, cursor: ReviewCursor): string {
  return `${version}:${cursor.section}:${cursor.line}`;
}

function rendered(
  sections: ReviewSection[],
  source: WorkspaceReviewSource,
  version: string,
  cursor: ReviewCursor,
  chunks: ReviewChunk[],
  baseline: string,
  blocked?: "allowance" | "ceiling",
  ceiling?: number,
  continuationBlocked = false,
): string {
  const complete = cursor.section >= sections.length;
  const continuationToken = complete
    ? "none"
    : continuationBlocked
      ? "unavailable (no progress)"
      : continuation(version, cursor);
  const binaryCount = sections.filter(
    (section) => section.kind === "binary",
  ).length;
  const hasPendingText = !complete;
  const lines = [
    "Tracked text review; untracked files are outside this review.",
    `Selected scope: ${source === "all" ? "staged and unstaged" : source}.`,
    `Baseline: ${baseline}.`,
    `Complete: ${complete ? "yes" : "no"}.`,
    binaryCount || hasPendingText
      ? `Coverage: incomplete;${binaryCount ? ` ${binaryCount} eligible binary change(s) are identified, but their contents are not displayed.` : ""}${hasPendingText ? " Eligible tracked text remains pending." : ""}`
      : "Coverage: complete for eligible tracked text changes.",
    ...(blocked === "allowance"
      ? [
          `The next line is not included at this allowance; retry with a higher allowance up to ${ceiling} tokens.`,
        ]
      : []),
    ...(blocked === "ceiling"
      ? [
          `The line remains unreviewed because it cannot fit within the configured ceiling of ${ceiling} tokens.`,
        ]
      : []),
    `Continuation: ${continuationToken}.`,
  ];
  for (const chunk of chunks) {
    const section = sections[chunk.section];
    const label = section.paths
      .map((name) => JSON.stringify(name))
      .join(" -> ");
    lines.push(
      `## ${section.source} section ${chunk.section + 1}: ${label}\n${chunk.lines.join("")}`,
    );
  }
  return redactSecrets(lines.join("\n\n"));
}

async function getReviewBaseline(context?: WorkspaceContext): Promise<string> {
  const result = await executeRtkCommand(
    "git",
    ["rev-parse", "--verify", "HEAD"],
    context,
  );
  if (!result.available) throw new Error("The `rtk` executable was not found.");
  if (result.exitCode === 0) return "HEAD";

  const status = await executeRtkCommand(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=no"],
    context,
  );
  if (!status.available) throw new Error("The `rtk` executable was not found.");
  if (status.exitCode !== 0)
    throw new Error("Git baseline could not be established.");

  const symbolicHead = await executeRtkCommand(
    "git",
    ["symbolic-ref", "--quiet", "HEAD"],
    context,
  );
  if (!symbolicHead.available)
    throw new Error("The `rtk` executable was not found.");
  if (symbolicHead.exitCode !== 0 || !symbolicHead.stdout.trim())
    throw new Error("Git baseline could not be established.");

  const branchRef = await executeRtkCommand(
    "git",
    ["show-ref", "--verify", "--quiet", symbolicHead.stdout.trim()],
    context,
  );
  if (!branchRef.available)
    throw new Error("The `rtk` executable was not found.");
  if (branchRef.exitCode === 1) return "unborn HEAD";
  throw new Error("Git baseline could not be established.");
}

function createReviewVersion(
  source: WorkspaceReviewSource,
  baseline: string,
  sections: ReviewSection[],
): string {
  const state = sections.map((section) => ({
    source: section.source,
    paths: section.paths,
    kind: section.kind,
    digest: createHash("sha256").update(section.rawContent).digest("hex"),
  }));
  return createHash("sha256")
    .update(JSON.stringify({ source, baseline, state }))
    .digest("hex")
    .slice(0, 24);
}

/** Retrieves whole eligible tracked diff sections with state-bound pagination. */
export async function getWorkspaceReviewOutcome(
  request: WorkspaceReviewRequest,
  context?: WorkspaceContext,
): Promise<WorkspaceReviewOutcome> {
  const source = request.source ?? "all";
  if (!(["all", "staged", "unstaged"] as string[]).includes(source))
    return {
      status: "failure",
      message: "Invalid source; choose all, staged, or unstaged.",
    };
  const ceiling = request.ceiling ?? request.allowance;
  if (
    !Number.isSafeInteger(request.allowance) ||
    request.allowance < 1 ||
    !Number.isSafeInteger(ceiling) ||
    ceiling < request.allowance
  )
    return {
      status: "failure",
      message: "Allowance must be a positive whole number.",
    };
  try {
    const sources =
      source === "all"
        ? (["staged", "unstaged"] as const)
        : ([source] as const);
    const sections = await collectSections([...sources], context);
    const baseline = await getReviewBaseline(context);
    const verifiedSections = await collectSections([...sources], context);
    if (JSON.stringify(sections) !== JSON.stringify(verifiedSections))
      return { status: "failure", message: RESTART };
    const verifiedBaseline = await getReviewBaseline(context);
    if (baseline !== verifiedBaseline)
      return { status: "failure", message: RESTART };
    const version = createReviewVersion(source, baseline, sections);
    let cursor = { section: 0, line: 0 };
    if (request.continuation) {
      const match = /^([a-f0-9]{24}):(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(
        request.continuation,
      );
      if (!match || match[1] !== version)
        return { status: "failure", message: RESTART };
      cursor = { section: Number(match[2]), line: Number(match[3]) };
      if (
        !Number.isSafeInteger(cursor.section) ||
        !Number.isSafeInteger(cursor.line) ||
        cursor.section < 0 ||
        cursor.section >= sections.length ||
        cursor.line < 0 ||
        cursor.line >= sections[cursor.section].lines.length
      )
        return { status: "failure", message: RESTART };
    }
    const pageStart = { ...cursor };
    const chunks: ReviewChunk[] = [];
    let blocked: "allowance" | "ceiling" | undefined;
    while (cursor.section < sections.length) {
      const section = sections[cursor.section];
      const chunk = chunks.at(-1);
      if (chunk?.section !== cursor.section) {
        chunks.push({
          section: cursor.section,
          startLine: cursor.line,
          lines: [],
        });
      }
      const current = chunks.at(-1)!;
      const currentLine = section.lines[cursor.line];
      if (currentLine === undefined) {
        cursor = { section: cursor.section + 1, line: 0 };
        continue;
      }
      current.lines.push(currentLine);
      const nextCursor =
        cursor.line + 1 >= section.lines.length
          ? { section: cursor.section + 1, line: 0 }
          : { section: cursor.section, line: cursor.line + 1 };
      const candidate = rendered(
        sections,
        source,
        version,
        nextCursor,
        chunks,
        baseline,
      );
      if (getTokenCount(candidate) <= request.allowance) {
        cursor = nextCursor;
        continue;
      }
      current.lines.pop();
      if (current.lines.length === 0) chunks.pop();
      const singleLine = rendered(
        sections,
        source,
        version,
        nextCursor,
        [
          {
            section: cursor.section,
            startLine: cursor.line,
            lines: [currentLine],
          },
        ],
        baseline,
      );
      blocked = getTokenCount(singleLine) <= ceiling ? "allowance" : "ceiling";
      break;
    }
    while (blocked && chunks.length > 0) {
      const content = rendered(
        sections,
        source,
        version,
        cursor,
        chunks,
        baseline,
        blocked,
        ceiling,
        blocked !== undefined &&
          cursor.section === pageStart.section &&
          cursor.line === pageStart.line,
      );
      if (getTokenCount(content) <= request.allowance) break;
      const lastChunk = chunks.at(-1)!;
      lastChunk.lines.pop();
      cursor = {
        section: lastChunk.section,
        line: lastChunk.startLine + lastChunk.lines.length,
      };
      if (lastChunk.lines.length === 0) chunks.pop();
    }
    const content = rendered(
      sections,
      source,
      version,
      cursor,
      chunks,
      baseline,
      blocked,
      ceiling,
      blocked !== undefined &&
        cursor.section === pageStart.section &&
        cursor.line === pageStart.line,
    );
    if (getTokenCount(content) > request.allowance)
      return { status: "failure", message: "output_limit_exceeded." };
    if (blocked === "ceiling") return { status: "incomplete", content };
    if (
      blocked !== undefined &&
      cursor.section === pageStart.section &&
      cursor.line === pageStart.line
    )
      return { status: "incomplete", content };
    if (
      cursor.section < sections.length &&
      cursor.section === pageStart.section &&
      cursor.line === pageStart.line &&
      !blocked
    )
      return { status: "failure", message: "output_limit_exceeded." };
    return { status: "success", content };
  } catch (error) {
    return {
      status: "failure",
      message:
        error instanceof Error &&
        error.message === "The `rtk` executable was not found."
          ? error.message
          : "Git workspace review failed before eligible changes could be checked.",
    };
  }
}

/** CLI entrypoint for the separate, read-only tracked workspace review. */
export async function runWorkspaceReview(args: string[] = []): Promise<void> {
  let source: WorkspaceReviewSource = "all";
  let sourceSeen = false;
  let continuation: string | undefined;
  let allowanceArg: string | undefined;
  let malformed = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--source") {
      const value = args[++index];
      if (
        sourceSeen ||
        value === undefined ||
        !["all", "staged", "unstaged"].includes(value)
      )
        malformed = true;
      else {
        source = value as WorkspaceReviewSource;
        sourceSeen = true;
      }
    } else if (arg.startsWith("--source=")) {
      const value = arg.slice("--source=".length);
      if (sourceSeen || !["all", "staged", "unstaged"].includes(value))
        malformed = true;
      else {
        source = value as WorkspaceReviewSource;
        sourceSeen = true;
      }
    } else if (arg === "--continuation") {
      const value = args[++index];
      if (!value || continuation !== undefined) malformed = true;
      else continuation = value;
    } else if (arg.startsWith("--continuation=")) {
      const value = arg.slice("--continuation=".length);
      if (!value || continuation !== undefined) malformed = true;
      else continuation = value;
    } else if (arg === "--allowance" || arg.startsWith("--allowance=")) {
      const value = arg === "--allowance" ? args[++index] : arg.slice(12);
      if (value === undefined || allowanceArg !== undefined) malformed = true;
      else allowanceArg = value;
    } else malformed = true;
  }
  if (malformed) {
    process.exitCode = 1;
    console.log(
      formatProxyOutput(
        "workspace-review",
        "Invalid workspace review options. Use spekta help workspace-review.",
        { exitCode: 1 },
      ),
    );
    return;
  }
  const resolved = resolveRequestAllowance("git", allowanceArg);
  if (resolved.status !== "ok") {
    process.exitCode = 1;
    console.log(
      formatProxyOutput(
        "workspace-review",
        resolved.status === "invalid"
          ? "Allowance must be a positive whole number."
          : `Allowance exceeds the configured Git ceiling of ${resolved.settings.ceilingTokens} tokens.`,
        { exitCode: 1 },
      ),
    );
    return;
  }
  const allowance = resolved.requested ?? resolved.settings.defaultTokens;
  // Leave room for the CLI's operation header and newline in the complete budget.
  const outcome = await getWorkspaceReviewOutcome({
    source,
    continuation,
    allowance: Math.max(1, allowance - 40),
    ceiling: Math.max(1, resolved.settings.ceilingTokens - 40),
  });
  const body = outcome.status === "failure" ? outcome.message : outcome.content;
  const output = formatProxyOutput(
    "workspace-review",
    body,
    outcome.status === "success" ? {} : { exitCode: 1 },
  );
  if (getTokenCount(`${output}\n`) > allowance) {
    process.exitCode = 1;
    console.log(
      formatProxyOutput("workspace-review", "output_limit_exceeded", {
        exitCode: 1,
      }),
    );
    return;
  }
  if (outcome.status !== "success") process.exitCode = 1;
  console.log(output);
}
