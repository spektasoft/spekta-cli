import path from "node:path";
import { getTokenCount } from "../../utils/read-utils";
import { resolveWorkspace, type WorkspaceContext } from "../../utils/workspace";
import { findRepositoryRoot } from "./proxy-git-policy";
import { isEligibleGitPath } from "./proxy-git-status";
import { formatProxyOutput, truncateOutput } from "./proxy-output";
import { redactSecrets } from "./proxy-secret-redaction";
import type { DiscoveryRenderOutcome } from "./proxy-ls-render";

const RESPONSE_LIMIT = 1000;

/** Render an explicit historical blob only after checking its repository identity. */
export async function renderGitBlobOutcome(
  result: { stdout: string; exitCode: number },
  selector: string,
  context?: WorkspaceContext,
): Promise<DiscoveryRenderOutcome> {
  if (result.exitCode !== 0) {
    return {
      status: "failure",
      message: `RTK command failed with exit status ${result.exitCode}.`,
      exitCode: result.exitCode,
    };
  }

  try {
    const colon = selector.indexOf(":");
    const blobPath = selector.slice(colon + 1);
    const workspace = await resolveWorkspace(context);
    const identity = path.relative(
      workspace.root,
      path.resolve(findRepositoryRoot(context), blobPath),
    );
    if (!(await isEligibleGitPath(identity, workspace))) {
      return {
        status: "failure",
        message: "Git blob disclosure refused: target is not eligible.",
        exitCode: 1,
      };
    }

    let budget = 900;
    while (budget > 0) {
      const truncated = truncateOutput(redactSecrets(result.stdout), budget);
      const rendered = formatProxyOutput("git", truncated.content, {
        truncated: truncated.truncated,
      });
      if (getTokenCount(`${rendered}\n`) <= RESPONSE_LIMIT) {
        return {
          status: "success",
          content: truncated.content,
          truncated: truncated.truncated,
        };
      }
      budget -= 25;
    }
    return {
      status: "failure",
      message: "Git blob response too large. Choose a smaller historical file.",
      exitCode: 1,
    };
  } catch {
    return {
      status: "failure",
      message: "Git blob disclosure could not be verified.",
      exitCode: 1,
    };
  }
}
