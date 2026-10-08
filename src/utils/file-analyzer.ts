import { getCompactThreshold, getReadTokenLimit } from "../core/config";
import { compactFile } from "./compactor";
import { getFileLines, getTokenCount } from "./read-utils";
import { validatePathAccess, validateReadPathAccess } from "./security";
import type { ResolvedWorkspace } from "./workspace";

export interface FileAnalysis {
  path: string;
  content: string;
  totalLines: number;
  rawTokens: number;
  finalTokens: number;
  isCompacted: boolean;
  compactionWarning?: string;
  exceedsLimit: boolean;
  excessTokens: number;
}

export async function analyzeFile(
  filePath: string,
  workspace?: ResolvedWorkspace,
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

  if (rawTokens > getCompactThreshold()) {
    const result = compactFile(filePath, content, 1);
    if (result.isCompacted) {
      finalContent = result.content;
      isCompacted = true;
    } else if (result.warning) {
      compactionWarning = result.warning;
    }
  }

  const finalTokens = getTokenCount(finalContent);
  const readTokenLimit = getReadTokenLimit();
  const exceedsLimit = finalTokens > readTokenLimit;

  return {
    path: filePath,
    content: finalContent,
    totalLines: total,
    rawTokens,
    finalTokens,
    isCompacted,
    compactionWarning,
    exceedsLimit,
    excessTokens: exceedsLimit ? finalTokens - readTokenLimit : 0,
  };
}
