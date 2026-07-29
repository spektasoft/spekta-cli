import fs from "fs-extra";
import path from "path";
import matter from "gray-matter";
import nunjucks from "nunjucks";
import {
  getEnv,
  listPrompts,
  renderPrompt,
  getGlobalPromptContext,
} from "../core/config";
import { searchableSelect } from "../ui/ui";
import { openEditor } from "../utils/editor-utils";
import { runRepl } from "./repl";

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

  const rawContent = await fs
    .readFile(path.join(process.cwd(), selectedFilename), "utf-8")
    .catch(async () => {
      return "";
    });

  const renderedBody = await renderPrompt(selectedFilename);
  const parsed = matter(rawContent);
  const context = getGlobalPromptContext();

  let defaultOutput = parsed.data.default_output;
  if (defaultOutput) {
    defaultOutput = nunjucks.renderString(defaultOutput, context);
  }

  const action = await searchableSelect<string>(
    "Choose action for rendered prompt:",
    [
      { name: "Save to File / Output", value: "save" },
      { name: "Execute directly in AI REPL", value: "repl" },
    ],
  );

  if (action === "save") {
    const targetPath =
      defaultOutput ||
      path.join(process.cwd(), `prompt-output-${context.id}.md`);
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, renderedBody, "utf-8");
    console.log(`Prompt output saved to: ${targetPath}`);

    const env = await getEnv();
    if (env.SPEKTA_EDITOR) {
      await openEditor(env.SPEKTA_EDITOR, targetPath);
    }
  } else if (action === "repl") {
    await runRepl();
  }
}
