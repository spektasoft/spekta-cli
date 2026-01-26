import fs from "fs-extra";
import path from "path";
import { Logger } from "../utils/logger";
import { validateParentDirForCreate } from "../utils/security";
import { formatFile } from "../utils/format-utils";
import { validatePathAccessForWrite } from "../utils/security";

export async function getWriteContent(
  filePath: string,
  content: string,
): Promise<{ success: boolean; message: string }> {
  const absolutePath = path.resolve(filePath);

  // 1. Security checks FIRST (prevent information leakage)
  await validatePathAccessForWrite(filePath);
  // 2. Validate parent directory ancestry (allows creation of nested dirs)
  await validateParentDirForCreate(filePath);

  // 3. Cannot already exist (safe to check after security validation)
  if (await fs.pathExists(absolutePath)) {
    return {
      success: false,
      message: `Write failed: File already exists at ${filePath}. Cannot overwrite with this tool.`,
    };
  }

  // 4. Format content (consistency with replace)
  let formattedContent: string;
  try {
    formattedContent = await formatFile(filePath, content);
  } catch (err: any) {
    Logger.warn(
      `Formatting failed: ${err.message}. Writing unformatted content.`,
    );
    formattedContent = content;
  }

  // 5. Write
  await fs.ensureDir(path.dirname(absolutePath));
  await fs.writeFile(absolutePath, formattedContent, "utf-8");

  return {
    success: true,
    message: `Successfully created and wrote ${filePath} (${formattedContent.length} bytes after formatting)`,
  };
}

export async function runWrite(args: string[] = []): Promise<void> {
  if (args.length !== 1) {
    Logger.error("Usage: spekta write <relative/path/to/newfile.ext>");
    Logger.error("Content must be provided via stdin.");
    process.exitCode = 1;
    return;
  }

  const filePath = args[0];

  try {
    // Read content from stdin
    let content = "";
    for await (const chunk of process.stdin) {
      content += chunk;
    }
    if (!content.trim()) {
      throw new Error("No content provided via stdin.");
    }

    const result = await getWriteContent(filePath, content);
    if (result.success) {
      Logger.info(result.message);
    } else {
      Logger.error(result.message);
      process.exitCode = 1;
    }
  } catch (err: any) {
    Logger.error(`Write failed: ${err.message}`);
    process.exitCode = 1;
  }
}
