import {
  resolveWorkspace,
  type ResolvedWorkspace,
  type WorkspaceContext,
} from "../../utils/workspace";
import { getTokenCount } from "../../utils/read-utils";
import { formatProxyOutput, truncateOutput } from "./proxy-output";
import { filterEligibleLsEntries } from "./proxy-ls";
import { filterEligibleFindEntries } from "./proxy-find-disclosure";
import { redactSecrets } from "./proxy-secret-redaction";

const DISCOVERY_RESPONSE_TOKEN_LIMIT = 1000;

export type DiscoveryRenderOutcome =
  | { status: "success"; content: string; truncated: boolean }
  | { status: "failure"; message: string; exitCode: number };

function failure(message: string, exitCode = 1): DiscoveryRenderOutcome {
  return { status: "failure", message, exitCode };
}

/**
 * Turn raw physical find or escaped ls output into the shared CLI/MCP listing. Entries
 * are filtered for eligibility before redaction and budgeting. Child stdout and
 * stderr are never forwarded on failure, because either may name denied entries.
 */
export async function renderDiscoveryOutcome(
  result: { stdout: string; exitCode: number },
  directory: string | undefined,
  context?: WorkspaceContext,
  command: "ls" | "find" = "ls",
): Promise<DiscoveryRenderOutcome> {
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

  const filtered = await (command === "find"
    ? filterEligibleFindEntries(result.stdout, directory ?? ".", workspace)
    : filterEligibleLsEntries(result.stdout, directory ?? ".", workspace));
  if (filtered.status === "ambiguous") return failure(filtered.message);

  // One JSON string per line keeps unusual names (including newlines and
  // Markdown delimiters) visibly within a single entry.
  const listing = redactSecrets(
    filtered.names
      .map((name) =>
        command === "find" &&
        !Array.from(name).some(
          (char) => char.charCodeAt(0) < 32 || char === "`",
        )
          ? name
          : JSON.stringify(name).replace(/`/g, "\\u0060"),
      )
      .join("\n"),
  );

  // The budget covers the complete CLI response: heading, badges, fences, and
  // the newline added by console.log. MCP text is a strict subset of it.
  let budget = DISCOVERY_RESPONSE_TOKEN_LIMIT;
  while (budget >= 1) {
    const truncated = truncateOutput(listing, budget);
    const rendered = formatProxyOutput(command, truncated.content, {
      truncated: truncated.truncated,
    });
    const over =
      getTokenCount(`${rendered}\n`) - DISCOVERY_RESPONSE_TOKEN_LIMIT;
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
