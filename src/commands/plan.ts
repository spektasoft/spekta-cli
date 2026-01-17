import path from "path";
import fs from "fs-extra";
import { execa } from "execa";
import { getEnv, getPromptContent } from "../config";
import { generateId, getPlansDir } from "../fs-manager";

export async function runPlan() {
  try {
    const env = await getEnv();
    const id = generateId();
    const plansDir = await getPlansDir();

    let template = await getPromptContent("plan.md");
    if (!/{{ID}}/.test(template)) {
      throw new Error(
        'Template "plan.md" must contain the placeholder {{ID}}.'
      );
    }
    const content = template.replace(/{{ID}}/g, id);

    const fileName = `${id}.md`;
    const filePath = path.join(plansDir, fileName);

    await fs.writeFile(filePath, content);
    console.log(`Implementation plan generated: ${filePath}`);

    const editor = env.SPEKTA_EDITOR;
    if (editor) {
      try {
        await execa(editor, [filePath], { stdio: "inherit" });
      } catch (editorError: any) {
        console.warn(`\nWarning: Failed to open editor "${editor}".`);
        console.warn(`Detail: ${editorError.message}`);
        console.log(`You can manually open the plan at: ${filePath}`);
      }
    } else {
      console.log(
        "Tip: Set SPEKTA_EDITOR in your .env to open this automatically."
      );
    }
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
