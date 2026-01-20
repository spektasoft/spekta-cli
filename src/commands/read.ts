import fs from "fs-extra";
import path from "path";
import { getEnv } from "../config";
import { processOutput } from "../editor-utils";
import { generateOverview } from "../utils/overview-scanner";
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
    const tokenLimit = parseInt(env.SPEKTA_READ_TOKEN_LIMIT || "500", 10);
    let combinedOutput = "";

    for (const req of requests) {
      await validatePathAccess(req.path);
      const fullContent = await fs.readFile(req.path, "utf-8");

      // Default to full range if not provided
      const range = req.range || { start: 1, end: "$" };
      const { lines, total } = await getFileLines(req.path, range);
      const contentToDisplay = lines.join("\n");
      const ext = path.extname(req.path).slice(1) || "txt";

      const header = `#### ${req.path} (lines ${range.start}-${range.end === "$" ? total : range.end} of ${total})`;

      let fileOutput = "";
      if (getTokenCount(contentToDisplay) > tokenLimit && !req.range) {
        const overview = generateOverview(fullContent);
        fileOutput = `${header}\n\`\`\`${ext}\n${overview}\n\`\`\`\n\n`;
      } else {
        fileOutput = `${header}\n\`\`\`${ext}\n${contentToDisplay}\n\`\`\`\n\n`;
      }
      combinedOutput += fileOutput;
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
