import { getCompactThreshold, getReadTokenLimit } from "../core/config";
import { compactFile } from "./compactor";
import { getFileLines, getTokenCount } from "./read-utils";
import { validatePathAccess, validateReadPathAccess } from "./security";
import type { ResolvedWorkspace } from "./workspace";
import { isStructuralOverviewUnavailable } from "./parser-capabilities";

export interface FileAnalysis {
  path: string;
  content: string;
  totalLines: number;
  rawTokens: number;
  finalTokens?: number;
  isCompacted: boolean;
  compactionWarning?: string;
  exceedsLimit?: boolean;
  excessTokens?: number;
}

export async function analyzeFile(
  filePath: string,
  workspace?: ResolvedWorkspace,
  platform: NodeJS.Platform = process.platform,
): Promise<FileAnalysis> {
  let readPath = filePath;
  if (workspace) {
    readPath = await validateReadPathAccess(filePath, workspace);
  } else {
    await validatePathAccess(filePath);
  }
  const { lines, total } = await getFileLines(readPath, {
    start: 1,
    end: "$",
  });
  const content = lines.join("\n");
  const rawTokens = getTokenCount(content);

  let finalContent = content;
  let isCompacted = false;
  let compactionWarning: string | undefined;
  const compactThreshold = getCompactThreshold();

  if (rawTokens > compactThreshold) {
    if (isStructuralOverviewUnavailable(platform)) {
      compactionWarning =
        "Compaction analysis is unavailable on Windows; only raw token counts are reported.";
    } else {
      const result = compactFile(filePath, content, 1);
      if (result.isCompacted) {
        finalContent = result.content;
        isCompacted = true;
      } else if (result.warning) {
        compactionWarning = result.warning;
      }
    }
  }

  const analysisUnavailable =
    rawTokens > compactThreshold && isStructuralOverviewUnavailable(platform);
  const finalTokens = analysisUnavailable
    ? undefined
    : getTokenCount(finalContent);
  const readTokenLimit = getReadTokenLimit();
  const exceedsLimit =
    finalTokens === undefined ? undefined : finalTokens > readTokenLimit;

  return {
    path: filePath,
    content: finalContent,
    totalLines: total,
    rawTokens,
    isCompacted,
    ...(finalTokens === undefined
      ? {}
      : {
          finalTokens,
          exceedsLimit,
          excessTokens: exceedsLimit ? finalTokens - readTokenLimit : 0,
        }),
    ...(compactionWarning === undefined ? {} : { compactionWarning }),
  };
}
