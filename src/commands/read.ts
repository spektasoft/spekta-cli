import path from "path";
import os from "os";
import fs from "fs-extra";
import { execa } from "execa";
import { getEnv } from "../config";
import { parseRange, getFileLines, getTokenCount } from "../utils/read-utils";
import { generateOverview } from "../utils/overview-scanner";
import { validatePathAccess } from "../utils/security";

export async function runRead(
  filePath?: string,
  rangeStr?: string,
  options: { save?: boolean } = {},
) {
  try {
    if (!filePath) throw new Error("File path is required.");

    await validatePathAccess(filePath);
    const range = parseRange(rangeStr);
    const env = await getEnv();
    const tokenLimit = parseInt(env.SPEKTA_READ_TOKEN_LIMIT || "500", 10);

    const fullContent = await fs.readFile(filePath, "utf-8");
    const { lines, total } = await getFileLines(filePath, range);
    const contentToDisplay = lines.join("\n");
    const ext = path.extname(filePath).slice(1) || "txt";

    let finalOutput = "";
    const header = `#### ${filePath} (lines ${range.start}-${range.end === "$" ? total : range.end} of ${total})`;

    if (
      getTokenCount(contentToDisplay) > tokenLimit &&
      rangeStr === undefined
    ) {
      const overview = generateOverview(fullContent);
      finalOutput = `${header}\n\`\`\`${ext}\n${overview}\n\`\`\``;
    } else {
      finalOutput = `${header}\n\`\`\`${ext}\n${contentToDisplay}\n\`\`\``;
    }

    if (options.save) {
      const tempPath = path.join(os.tmpdir(), `spekta-read-${Date.now()}.md`);
      await fs.writeFile(tempPath, finalOutput);
      console.log(`Context saved to: ${tempPath}`);

      const editor = env.SPEKTA_EDITOR;
      if (editor) {
        await execa(editor, [tempPath], { stdio: "inherit" });
      }
    } else {
      process.stdout.write(finalOutput + "\n");
    }
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
