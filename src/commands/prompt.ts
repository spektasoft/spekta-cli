import fs from "fs-extra";
import nunjucks from "nunjucks";
import path from "path";
import {
  getEnv,
  getGlobalPromptContext,
  listPrompts,
  resolvePrompt,
  renderPrompt,
} from "../core/config";
import { searchableSelect } from "../ui/ui";
import { openEditor } from "../utils/editor-utils";
import { getUncategorizedBasePath } from "../fs/fs-manager";

export interface PromptArgs {
  selector?: string;
  stdout: boolean;
  output?: string;
}

export function parsePromptArgs(args: string[] = []): PromptArgs {
  let selector: string | undefined;
  let output: string | undefined;
  let stdout = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--stdout") stdout = true;
    else if (arg === "--output") {
      output = args[++i];
      if (!output || output.startsWith("--"))
        throw new Error("Missing value for --output");
    } else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else if (selector) throw new Error("Only one prompt selector is allowed.");
    else selector = arg;
  }
  return { selector, stdout, output };
}

export async function resolvePromptFilename(selector: string): Promise<string> {
  return (await resolvePrompt(selector)).filename;
}

export async function renderAndSavePrompt(
  filename: string,
  metadata: Record<string, any>,
  args: PromptArgs,
): Promise<void> {
  const renderedBody = await renderPrompt(filename);
  if (args.stdout) {
    process.stdout.write(renderedBody);
    return;
  }
  const context = getGlobalPromptContext();
  const defaultOutput = metadata.default_output
    ? nunjucks.renderString(metadata.default_output, context)
    : undefined;
  const targetPath = path.resolve(
    args.output ||
      defaultOutput ||
      path.join(getUncategorizedBasePath(), `${context.id}.md`),
  );
  await fs.ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, renderedBody, "utf-8");
  const diagnostic = `Prompt output saved to: ${targetPath}`;
  console.log(diagnostic);
  const env = await getEnv();
  if (env.SPEKTA_EDITOR) await openEditor(env.SPEKTA_EDITOR, targetPath);
}

export async function runPromptRunner(rawArgs: string[] = []): Promise<void> {
  const args = parsePromptArgs(rawArgs);
  const prompts = await listPrompts();
  if (prompts.length === 0) {
    console.log("No custom or composable prompts found.");
    return;
  }
  const choices = prompts.map((p) => ({
    name: `${p.name} - ${p.description}`,
    value: p.filename,
  }));
  let selected;
  if (args.selector) selected = await resolvePrompt(args.selector);
  else {
    const selectedFilename = await searchableSelect<string>("Select prompt to execute:", choices);
    selected = prompts.find((p) => p.filename === selectedFilename);
  }
  if (!selected)
    throw new Error(`Prompt could not be resolved: ${args.selector}`);
  await renderAndSavePrompt(selected.filename, selected, args);
}
