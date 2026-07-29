import fs from "fs-extra";
import matter from "gray-matter";
import nunjucks from "nunjucks";
import path from "path";
import { Logger } from "../../utils/logger";
import { getAssetPaths, HOME_PROMPTS } from "./paths.js";
import { loadToolDefinitions } from "./tools.js";
import { PromptMetadata, ToolDefinition } from "./types.js";
import { getGlobalPromptContext } from "./context.js";

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

export const renderPrompt = async (
  fileName: string,
  extraContext: Record<string, any> = {},
): Promise<string> => {
  const assetPaths = getAssetPaths();

  // Setup Nunjucks environment with multi-path loaders (prompts dir & parent dirs for partials)
  const loaders: nunjucks.ILoader[] = [
    new nunjucks.FileSystemLoader(HOME_PROMPTS, { noCache: true }),
    new nunjucks.FileSystemLoader(path.dirname(HOME_PROMPTS), {
      noCache: true,
    }),
  ];
  if (await fs.pathExists(assetPaths.ASSET_PROMPTS)) {
    loaders.push(
      new nunjucks.FileSystemLoader(assetPaths.ASSET_PROMPTS, {
        noCache: true,
      }),
      new nunjucks.FileSystemLoader(path.dirname(assetPaths.ASSET_PROMPTS), {
        noCache: true,
      }),
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
  const tools = (await toolLoader())
    .map(
      (t) =>
        `<tool>\n<name>${t.name}</name>\n<description>${t.description}</description>\n</tool>`,
    )
    .join("\n\n");
  return renderPrompt(fileName, { tools });
};
