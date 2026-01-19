import os from "os";
import path from "path";
import fs from "fs-extra";
import { execa } from "execa";
import { getEnv } from "./config";

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

export async function processOutput(
  content: string,
  prefix: string,
  silent: boolean = false,
): Promise<string> {
  const tempFileName = `${prefix}-${Date.now()}.md`;
  const filePath = path.join(os.tmpdir(), tempFileName);
  await fs.writeFile(filePath, content, "utf-8");

  const env = await getEnv();
  const editor = env.SPEKTA_EDITOR;

  if (editor) {
    try {
      await openEditor(editor, filePath);
    } catch (error: any) {
      console.warn(`Warning: Could not open editor: ${error.message}`);
    }
  } else if (!silent) {
    console.log(`\nGenerated Content (${prefix}):\n`);
    console.log("─".repeat(60));
    console.log(content);
    console.log("─".repeat(60));
    console.log("");
  }

  console.log(`Output saved to: ${filePath}`);
  return filePath;
}
