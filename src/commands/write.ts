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

  // 3. Create parent directories, then exclusively create the file
  await fs.ensureDir(path.dirname(absolutePath));

  try {
    await fs.writeFile(absolutePath, content, {
      encoding: "utf-8",
      flag: "wx",
    });
  } catch (err: unknown) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;

    if (code === "EEXIST") {
      return {
        success: false,
        message: `Write failed: File already exists at ${filePath}. Cannot overwrite with this tool.`,
      };
    }

    throw err;
  }

  // 4. Format in-place
  try {
    await formatFileInPlace(filePath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: true,
      message:
        `Successfully created and wrote ${filePath}\n` +
        `Warning: Content was saved to "${filePath}", but formatting failed: ${message}. Retrying the mutation is unnecessary.`,
    };
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
