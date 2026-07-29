import fs from "fs-extra";
import path from "path";
import { getEnv, renderPrompt } from "../core/config";
import { openEditor } from "../utils/editor-utils";
import { generateId, getPlansDir } from "../fs/fs-manager";

export async function runPlan() {
  try {
    const env = await getEnv();
    const plansDir = await getPlansDir();

    const content = await renderPrompt("plan.md");

    const idMatch = content.match(/# Implementation Plan: ([a-f0-9]+)/);
    const id = idMatch ? idMatch[1] : generateId();

    const fileName = `${id}.md`;
    const filePath = path.join(plansDir, fileName);

    await fs.writeFile(filePath, content);
    console.log(`Implementation plan generated: ${filePath}`);

    const editor = env.SPEKTA_EDITOR;
    if (editor) {
      try {
        await openEditor(editor, filePath);
      } catch (editorError: any) {
        console.warn(`\nWarning: ${editorError.message}`);
        console.log(`You can manually open the plan at: ${filePath}`);
      }
    } else {
      console.log(
        "Tip: Set SPEKTA_EDITOR in your .env to open this automatically.",
      );
    }
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
