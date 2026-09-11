import fs from "fs-extra";
import matter from "gray-matter";
import nunjucks from "nunjucks";
import path from "path";
import { Logger } from "../../utils/logger";
import { getAssetPaths, HOME_PROMPTS } from "./paths.js";
import { loadToolDefinitions } from "./tools.js";
import { PromptMetadata, ToolDefinition } from "./types.js";
import { getGlobalPromptContext } from "./context.js";
import {
  listPartials,
  resolveSelectedPartials,
  validatePartialSelection,
  PartialSelection,
  SelectivePartialLoader,
} from "./partials.js";

export const listPrompts = async (): Promise<PromptMetadata[]> => {
  const assetPaths = getAssetPaths();
  const promptMap = new Map<string, PromptMetadata>();

  const scanDirectory = async (dirPath: string) => {
    if (!(await fs.pathExists(dirPath))) return;
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name === "partials") {
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".md")) {
        try {
          const filePath = path.join(dirPath, entry.name);
          const content = await fs.readFile(filePath, "utf-8");
          const parsed = matter(content);

          if (parsed.data && parsed.data.name && parsed.data.description) {
            promptMap.set(entry.name, {
              filename: entry.name,
              name: parsed.data.name,
              description: parsed.data.description,
              ...parsed.data,
            });
          }
        } catch (err) {
          Logger.warn(
            `Failed to parse frontmatter for prompt ${entry.name}: ${err}`,
          );
        }
      }
    }
  };

  // Scan internal asset prompt directory first, then allow user HOME_PROMPTS overrides
  if (await fs.pathExists(assetPaths.ASSET_PROMPTS)) {
    await scanDirectory(assetPaths.ASSET_PROMPTS);
  }
  if (await fs.pathExists(HOME_PROMPTS)) {
    await scanDirectory(HOME_PROMPTS);
  }

  return Array.from(promptMap.values());
};

export const resolvePrompt = async (
  selector: string,
): Promise<PromptMetadata> => {
  const prompts = await listPrompts();
  const resolved =
    prompts.find((p) => p.filename === selector) ??
    prompts.find((p) => p.name === selector);
  if (!resolved)
    throw new Error(
      `Prompt '${selector}' could not be resolved as a filename or YAML metadata name. Available prompts: ${prompts.map((p) => `${p.filename} (${p.name})`).join(", ") || "none"}`,
    );
  return resolved;
};

export const renderPrompt = async (
  fileName: string,
  extraContext: Record<string, any> = {},
  partialSelection: PartialSelection = { include: [], exclude: [] },
): Promise<string> => {
  const assetPaths = getAssetPaths();
  const validatedSelection = await validatePartialSelection(partialSelection);
  const availablePartials = await listPartials();
  const selectedPartials = new Set(
    resolveSelectedPartials(
      availablePartials.map((partial) => partial.name),
      validatedSelection,
    ),
  );

  // Setup Nunjucks environment with multi-path loaders (prompts dir & parent dirs for partials)
  const loaders: nunjucks.ILoader[] = [
    new SelectivePartialLoader(HOME_PROMPTS, selectedPartials),
    new SelectivePartialLoader(path.dirname(HOME_PROMPTS), selectedPartials),
  ];
  if (await fs.pathExists(assetPaths.ASSET_PROMPTS)) {
    loaders.push(
      new SelectivePartialLoader(assetPaths.ASSET_PROMPTS, selectedPartials),
      new SelectivePartialLoader(
        path.dirname(assetPaths.ASSET_PROMPTS),
        selectedPartials,
      ),
    );
  }

  const env = new nunjucks.Environment(loaders, { autoescape: false });

  let filePath = path.join(HOME_PROMPTS, fileName);
  if (!(await fs.pathExists(filePath))) {
    filePath = path.join(assetPaths.ASSET_PROMPTS, fileName);
  }
  if (!(await fs.pathExists(filePath))) {
    throw new Error(`Prompt file not found: ${fileName}`);
  }

  const rawContent = await fs.readFile(filePath, "utf-8");
  const parsed = matter(rawContent);

  // Combine safe global context with extra context passed in
  const globalContext = getGlobalPromptContext(extraContext);
  const renderedBody = env.renderString(parsed.content, globalContext);
  return renderedBody.replace(/^\r?\n/, "");
};

export const getPromptContent = async (
  fileName: string,
  toolLoader: () => Promise<ToolDefinition[]> = loadToolDefinitions,
): Promise<string> => {
  const toolDefs = await toolLoader();
  const toolSections = toolDefs.map(
    (t) =>
      `#### ${t.name}\n\n${t.description}\n\nExample:\n\n\`\`\`xml\n${t.xml_example}\n\`\`\``,
  );
  const tools = toolDefs.length
    ? `### Tools\n\n${toolSections.join("\n\n")}`
    : "";
  return renderPrompt(fileName, { tools });
};
