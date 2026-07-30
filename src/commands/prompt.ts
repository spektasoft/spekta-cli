import fs from "fs-extra";
import matter from "gray-matter";
import nunjucks from "nunjucks";
import path from "path";
import {
  getAssetPaths,
  getEnv,
  getGlobalPromptContext,
  HOME_PROMPTS,
  listPrompts,
  renderPrompt,
} from "../core/config";
import { searchableSelect } from "../ui/ui";
import { openEditor } from "../utils/editor-utils";
import { getUncategorizedBasePath } from "../fs/fs-manager";

export async function runPromptRunner(): Promise<void> {
  const prompts = await listPrompts();
  if (prompts.length === 0) {
    console.log("No custom or composable prompts found.");
    return;
  }

  const choices = prompts.map((p) => ({
    name: `${p.name} - ${p.description}`,
    value: p.filename,
  }));

  const selectedFilename = await searchableSelect<string>(
    "Select prompt to execute:",
    choices,
  );

  const assetPaths = getAssetPaths();
  let filePath = path.join(HOME_PROMPTS, selectedFilename);
  if (!(await fs.pathExists(filePath))) {
    filePath = path.join(assetPaths.ASSET_PROMPTS, selectedFilename);
  }

  const rawContent = (await fs.pathExists(filePath))
    ? await fs.readFile(filePath, "utf-8")
    : "";

  const renderedBody = await renderPrompt(selectedFilename);
  const parsed = matter(rawContent);
  const context = getGlobalPromptContext();

  let defaultOutput = parsed.data.default_output;
  if (defaultOutput) {
    defaultOutput = nunjucks.renderString(defaultOutput, context);
  }

  const targetPath = defaultOutput
    ? path.resolve(process.cwd(), defaultOutput)
    : path.join(getUncategorizedBasePath(), `${context.id}.md`);

  await fs.ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, renderedBody, "utf-8");
  console.log(`Prompt output saved to: ${targetPath}`);

  const env = await getEnv();
  if (env.SPEKTA_EDITOR) {
    await openEditor(env.SPEKTA_EDITOR, targetPath);
  }
}
