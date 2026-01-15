import os from "os";
import path from "path";
import fs from "fs-extra";
import { execa } from "execa";

/**
 * Saves content to a temporary markdown file.
 */
export async function saveToTempFile(
  content: string,
  prefix: string
): Promise<string> {
  const tempFileName = `${prefix}-${Date.now()}.md`;
  const tempFilePath = path.join(os.tmpdir(), tempFileName);
  await fs.writeFile(tempFilePath, content, "utf-8");
  return tempFilePath;
}

/**
 * Opens a file in the specified editor and waits for the process to exit.
 */
export async function openEditor(
  editorCommand: string,
  filePath: string
): Promise<void> {
  try {
    await execa(editorCommand, [filePath], { stdio: "inherit" });
  } catch (error: any) {
    throw new Error(
      `Failed to open editor "${editorCommand}": ${error.message}`
    );
  }
}
