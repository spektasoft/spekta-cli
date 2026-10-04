import {
  resolveWorkspace,
  type ResolvedWorkspace,
  type WorkspaceContext,
} from "../../utils/workspace";
import { getTokenCount } from "../../utils/read-utils";
import { formatProxyOutput, truncateOutput } from "./proxy-output";
import { filterEligibleLsEntries } from "./proxy-ls";
import { redactSecrets } from "./proxy-secret-redaction";

const LS_RESPONSE_TOKEN_LIMIT = 1000;

export type LsRenderOutcome =
  | { status: "success"; content: string; truncated: boolean }
  | { status: "failure"; message: string; exitCode: number };

function failure(message: string, exitCode = 1): LsRenderOutcome {
  return { status: "failure", message, exitCode };
}

/**
 * Turn raw `rtk proxy ls -1Ab` output into the shared CLI/MCP listing. Entries
 * are filtered for eligibility before redaction and budgeting. Child stdout and
 * stderr are never forwarded on failure, because either may name denied entries.
 */
export async function renderLsOutcome(
  result: { stdout: string; exitCode: number },
  directory: string | undefined,
  context?: WorkspaceContext,
): Promise<LsRenderOutcome> {
  if (result.exitCode !== 0) {
    return failure(
      `RTK command failed with exit status ${result.exitCode}.`,
      result.exitCode,
    );
  }

  let workspace: ResolvedWorkspace;
  try {
    workspace = await resolveWorkspace(context);
  } catch {
    return failure("Listing rejected by workspace policy.");
  }

  const filtered = await filterEligibleLsEntries(
    result.stdout,
    directory ?? ".",
    workspace,
  );
  if (filtered.status === "ambiguous") return failure(filtered.message);

  // One JSON string per line keeps unusual names (including newlines and
  // Markdown delimiters) visibly within a single entry.
  const listing = redactSecrets(
    filtered.names
      .map((name) => JSON.stringify(name).replace(/`/g, "\\u0060"))
      .join("\n"),
  );

  // The budget covers the complete CLI response: heading, badges, fences, and
  // the newline added by console.log. MCP text is a strict subset of it.
  let budget = LS_RESPONSE_TOKEN_LIMIT;
  while (budget >= 1) {
    const truncated = truncateOutput(listing, budget);
    const rendered = formatProxyOutput("ls", truncated.content, {
      truncated: truncated.truncated,
    });
    const over = getTokenCount(`${rendered}\n`) - LS_RESPONSE_TOKEN_LIMIT;
    if (over <= 0) {
      return {
        status: "success",
        content: truncated.content,
        truncated: truncated.truncated,
      };
    }
    budget -= over;
  }
  return failure("Listing too large to display. Choose a narrower directory.");
}
