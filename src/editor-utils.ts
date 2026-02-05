import { execa } from "execa";
import fs from "fs-extra";
import { getEnv } from "./config";
import { getTempPath } from "./utils/fs-utils";

// Use dynamic import for shlex to avoid requiring it during build time
async function getShlex() {
  const { split } = await import("shlex");
  return { split };
}

/**
 * Opens a file in the specified editor and waits for the process to exit.
 */
export async function openEditor(
  editorCommand: string,
  filePath: string,
): Promise<void> {
  if (!editorCommand) {
    throw new Error("No editor command provided.");
  }

  try {
    // Handle quotes and spaces correctly using shlex
    const { split } = await getShlex();
    const parts = split(editorCommand);
    const bin = parts[0];
    const args = [...parts.slice(1), filePath];

    await execa(bin, args, {
      stdio: "inherit",
      shell: false, // Explicitly disable shell to prevent injection
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
  const filePath = getTempPath(prefix);
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
