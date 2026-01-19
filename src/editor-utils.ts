import os from "os";
import path from "path";
import fs from "fs-extra";
import { execa } from "execa";
import { getEnv } from "./config";

/**
 * Saves content to a temporary markdown file.
 */
export async function saveToTempFile(
  content: string,
  prefix: string,
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
  filePath: string,
): Promise<void> {
  try {
    await execa(editorCommand, [filePath], {
      stdio: "inherit",
    });
  } catch (error: any) {
    throw new Error(
      `Failed to open editor "${editorCommand}": ${error.message}`,
    );
  }
}

export async function finalizeOutput(
  content: string,
  prefix: string,
  successMessage: string,
): Promise<void> {
  const filePath = await saveToTempFile(content, prefix);
  console.log(`${successMessage}: ${filePath}`);

  const env = await getEnv();
  const editor = env.SPEKTA_EDITOR;

  if (editor) {
    try {
      await openEditor(editor, filePath);
    } catch (error: any) {
      console.warn(`Warning: Could not open editor: ${error.message}`);
    }
  }
}

export async function prepareTempMessageFile(
  content: string,
  prefix: string = "spekta",
): Promise<string> {
  const filePath = await saveToTempFile(content, prefix);

  const env = await getEnv();
  const editor = env.SPEKTA_EDITOR;

  if (editor) {
    try {
      await openEditor(editor, filePath);
    } catch (error: any) {
      console.warn(`Could not open editor: ${error.message}`);
    }
  } else {
    // Show full content when no editor
    console.log("\nGenerated commit message:\n");
    console.log("─".repeat(60));
    console.log(content);
    console.log("─".repeat(60));
    console.log("");
  }

  console.log(`Message saved at: ${filePath}`);
  return filePath;
}
