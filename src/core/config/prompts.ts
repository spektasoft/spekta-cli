import fs from "fs-extra";
import matter from "gray-matter";
import nunjucks from "nunjucks";
import path from "path";
import { Logger } from "../../utils/logger";
import { getAssetPaths, HOME_PROMPTS } from "./paths.js";
import { loadToolDefinitions } from "./tools.js";
import { PromptMetadata, ToolDefinition } from "./types.js";

export const listPrompts = async (): Promise<PromptMetadata[]> => {
  const assetPaths = getAssetPaths();
  const promptMap = new Map<string, PromptMetadata>();

  // 1. Scan asset paths first
  if (await fs.pathExists(assetPaths.ASSET_PROMPTS)) {
    const assetFiles = await fs.readdir(assetPaths.ASSET_PROMPTS);
    for (const file of assetFiles) {
      if (file.endsWith(".md")) {
        try {
          const content = await fs.readFile(
            path.join(assetPaths.ASSET_PROMPTS, file),
            "utf-8",
          );
          const parsed = matter(content);
          promptMap.set(file, {
            filename: file,
            name: parsed.data.name || file.replace(".md", ""),
            description: parsed.data.description || "",
            ...parsed.data,
          });
        } catch (err) {
          Logger.warn(
            `Failed to parse frontmatter for asset prompt ${file}: ${err}`,
          );
        }
      }
    }
  }

  // 2. Scan user home prompts (overriding assets with same filename)
  if (await fs.pathExists(HOME_PROMPTS)) {
    const userFiles = await fs.readdir(HOME_PROMPTS);
    for (const file of userFiles) {
      if (file.endsWith(".md")) {
        try {
          const content = await fs.readFile(
            path.join(HOME_PROMPTS, file),
            "utf-8",
          );
          const parsed = matter(content);
          promptMap.set(file, {
            filename: file,
            name: parsed.data.name || file.replace(".md", ""),
            description: parsed.data.description || "",
            ...parsed.data,
          });
        } catch (err) {
          Logger.warn(
            `Failed to parse frontmatter for user prompt ${file}: ${err}`,
          );
        }
      }
    }
  }

  return Array.from(promptMap.values());
};

export const renderPrompt = async (
  fileName: string,
  context: Record<string, any> = {},
): Promise<string> => {
  const assetPaths = getAssetPaths();

  // Setup Nunjucks environment with multi-path loaders (user dir first, then asset dir)
  const loaders = [
    new nunjucks.FileSystemLoader(HOME_PROMPTS, { noCache: true }),
  ];
  if (await fs.pathExists(assetPaths.ASSET_PROMPTS)) {
    loaders.push(
      new nunjucks.FileSystemLoader(assetPaths.ASSET_PROMPTS, {
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

  const renderedBody = env.renderString(parsed.content, context);
  return renderedBody;
};

export const getPromptContent = async (
  fileName: string,
  toolLoader: () => Promise<ToolDefinition[]> = loadToolDefinitions,
): Promise<string> => {
  const tools = await toolLoader();
  const toolUsageText = tools
    .map(
      (t) =>
        `<tool>\n<name>${t.name}</name>\n<description>${t.description}</description>\n</tool>`,
    )
    .join("\n\n");

  return renderPrompt(fileName, { tools, TOOL_USAGE: toolUsageText });
};
