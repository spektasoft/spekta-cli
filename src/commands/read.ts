import path from "path";
import { getEnv } from "../config";
import { processOutput } from "../editor-utils";
import { FileRequest, getFileLines, getTokenCount } from "../utils/read-utils";
import { validatePathAccess } from "../utils/security";
import { compactFile } from "../utils/compactor";

const COMPACTION_ADVISORY = `
#### COMPACTION NOTICE
Parts of the following file(s) have been collapsed for brevity.
Line numbers in comments (e.g., // ... [lines 20-60 collapsed]) are absolute.
DO NOT perform line-offset calculations based on visual line counts.

#### GUIDANCE FOR AGENT:
If you need to see collapsed content, request specific line ranges.
Targeted line range requests are NEVER compacted.
Example: file.ts[20,60]
`.trim();

export async function runRead(
  requests: FileRequest[],
  options: { save?: boolean } = {},
) {
  try {
    if (!requests || requests.length === 0)
      throw new Error("At least one file path is required.");

    const env = await getEnv();
    const tokenLimit = parseInt(env.SPEKTA_READ_TOKEN_LIMIT || "2000", 10);
    const compactThreshold = 500;
    let combinedOutput = "";
    let anyCompacted = false;

    for (const req of requests) {
      await validatePathAccess(req.path);
      const { lines, total } = await getFileLines(
        req.path,
        req.range || { start: 1, end: "$" },
      );

      // Calculate the actual starting line number for absolute referencing
      const startLineOffset = req.range
        ? typeof req.range.start === "number"
          ? req.range.start
          : 1
        : 1;

      const isRangeRequest = !!req.range;
      let content = lines.join("\n");
      let tokens = 0;
      let isCompacted = false;

      // POLICY: Bypass compaction for targeted range requests
      if (!isRangeRequest) {
        const CHAR_THRESHOLD = compactThreshold * 4;
        if (content.length > CHAR_THRESHOLD) {
          // Pass startLineOffset to ensure correct absolute numbering
          const result = compactFile(req.path, content, startLineOffset);
          if (result.isCompacted) {
            content = result.content;
            isCompacted = true;
            anyCompacted = true;
          }
        }
      }

      tokens = getTokenCount(content);

      // POLICY: Enforce hard limit for range requests to prevent token waste
      if (isRangeRequest && tokens > tokenLimit) {
        const errorMessage = `Error: Requested range for ${req.path} exceeds token limit (${tokens} > ${tokenLimit}). Please request a smaller range.`;
        console.error(errorMessage);
        combinedOutput += `\n--- ${req.path} ERROR ---\n${errorMessage}\n`;
        continue; // Skip processing this file
      }

      if (tokens > tokenLimit && !isCompacted) {
        console.warn(
          `Warning: ${req.path} exceeds token limit (${tokens} > ${tokenLimit}) and could not be compacted.`,
        );
      }

      const ext = path.extname(req.path).slice(1) || "txt";
      const rangeLabel = req.range
        ? `${req.range.start}-${req.range.end === "$" ? total : req.range.end}`
        : `1-${total}`;

      const compactLabel = isCompacted ? " [COMPACTED OVERVIEW]" : "";

      combinedOutput += `#### ${req.path} (lines ${rangeLabel})${compactLabel}\n\`\`\`${ext}\n${content}\n\`\`\`\n\n`;
    }

    if (options.save) {
      const finalContent = anyCompacted
        ? `${COMPACTION_ADVISORY}\n\n${combinedOutput}`
        : combinedOutput;
      await processOutput(finalContent, "spekta-read");
    } else {
      process.stdout.write(combinedOutput);
    }
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
