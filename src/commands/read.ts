import path from "path";
import { getEnv } from "../config";
import { processOutput } from "../editor-utils";
import { FileRequest, getFileLines, getTokenCount } from "../utils/read-utils";
import { validatePathAccess } from "../utils/security";

export async function runRead(
  requests: FileRequest[],
  options: { save?: boolean } = {},
) {
  try {
    if (!requests || requests.length === 0)
      throw new Error("At least one file path is required.");

    const env = await getEnv();
    const tokenLimit = parseInt(env.SPEKTA_READ_TOKEN_LIMIT || "1000", 10);
    let combinedOutput = "";

    for (const req of requests) {
      await validatePathAccess(req.path);
      const { lines, total } = await getFileLines(
        req.path,
        req.range || { start: 1, end: "$" },
      );
      const content = lines.join("\n");
      const tokens = getTokenCount(content);

      if (tokens > tokenLimit) {
        console.warn(
          `Warning: ${req.path} exceeds token limit (${tokens} > ${tokenLimit})`,
        );
      }

      const ext = path.extname(req.path).slice(1) || "txt";
      const rangeLabel = req.range
        ? `${req.range.start}-${req.range.end === "$" ? total : req.range.end}`
        : `1-${total}`;
      combinedOutput += `#### ${req.path} (lines ${rangeLabel})\n\`\`\`${ext}\n${content}\n\`\`\`\n\n`;
    }

    if (options.save) {
      await processOutput(combinedOutput, "spekta-read");
    } else {
      process.stdout.write(combinedOutput);
    }
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
