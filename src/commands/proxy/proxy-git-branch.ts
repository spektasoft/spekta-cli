import { getTokenCount } from "../../utils/read-utils";
import { formatProxyOutput, truncateOutput } from "./proxy-output";
import { redactSecrets } from "./proxy-secret-redaction";
import type { DiscoveryRenderOutcome } from "./proxy-ls-render";

const RESPONSE_LIMIT = 1000;

/** Render branch names only; verbose upstream and commit text is never disclosed. */
export function renderGitBranchOutcome(result: {
  stdout: string;
  exitCode: number;
}): DiscoveryRenderOutcome {
  if (result.exitCode !== 0) {
    return {
      status: "failure",
      message: `RTK command failed with exit status ${result.exitCode}.`,
      exitCode: result.exitCode,
    };
  }

  // Git branch names cannot contain line breaks. Reject output we cannot
  // attribute to one name rather than forwarding unrecognized child text.
  if (
    Array.from(result.stdout).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && character !== "\n") || code === 127;
    })
  ) {
    return {
      status: "failure",
      message:
        "Git branch listing rejected: entries could not be attributed reliably.",
      exitCode: 1,
    };
  }

  const listing = redactSecrets(result.stdout.trimEnd()).replace(
    /`/g,
    "\\u0060",
  );
  let budget = RESPONSE_LIMIT;
  while (budget > 0) {
    const truncated = truncateOutput(listing, budget);
    const cli = formatProxyOutput("git", truncated.content, {
      truncated: truncated.truncated,
    });
    const mcp = JSON.stringify({
      isError: false,
      content: [{ type: "text", text: truncated.content }],
    });
    if (
      getTokenCount(`${cli}\n`) <= RESPONSE_LIMIT &&
      getTokenCount(mcp) <= RESPONSE_LIMIT
    ) {
      return { status: "success", ...truncated };
    }
    budget -= 25;
  }

  return {
    status: "failure",
    message: "Git branch listing too large. Choose a narrower branch pattern.",
    exitCode: 1,
  };
}
