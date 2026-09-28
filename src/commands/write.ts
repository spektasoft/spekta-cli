import fs from "fs-extra";
import path from "path";
import { resolveCommandInput } from "../utils/cli-input";
import { Logger } from "../utils/logger";
import { validateParentDirForCreate } from "../utils/security";
import { formatFileInPlace } from "../utils/format-utils";
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

  // 4. Write unformatted content
  await fs.ensureDir(path.dirname(absolutePath));
  await fs.writeFile(absolutePath, content, "utf-8");

  // 5. Format in-place
  try {
    await formatFileInPlace(filePath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Logger.warn(`Formatting failed: ${message}.`);
  }

  return {
    success: true,
    message: `Successfully created and wrote ${filePath}`,
  };
}

export async function runWrite(args?: string[]): Promise<void> {
  const usageMessage =
    "Usage: spekta write <relative/path/to/newfile.ext> [content]\n" +
    "Content may be passed as an argument or provided via stdin.";

  try {
    const resolved = await resolveCommandInput(args, usageMessage);
    if (!resolved) {
      return;
    }

    const result = await getWriteContent(resolved.filePath, resolved.content);
    if (result.success) {
      Logger.info(result.message);
    } else {
      Logger.error(result.message);
      process.exitCode = 1;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Logger.error(`Write failed: ${message}`);
    process.exitCode = 1;
  }
}
