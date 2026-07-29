import fs from "fs-extra";
import { getEnv } from "./env.js";
import {
  getAssetPaths,
  HOME_DEFAULT_IGNORE,
  HOME_DIR,
  HOME_IGNORE,
  HOME_PROMPTS,
  HOME_TOOLS,
  refreshPaths,
} from "./paths.js";
import path from "path";

export const bootstrap = async () => {
  await getEnv();
  refreshPaths();

  await fs.ensureDir(HOME_DIR);
  await fs.ensureDir(HOME_PROMPTS);
  await fs.ensureDir(HOME_TOOLS);

  const { ASSET_TOOLS, ASSET_DEFAULT_IGNORE, ASSET_PROMPTS } = getAssetPaths();

  // Asset Integrity Check
  if (!(await fs.pathExists(ASSET_TOOLS))) {
    throw new Error(
      `Critical Error: Internal tool templates not found at ${ASSET_TOOLS}`,
    );
  }

  // Synchronize Managed Defaults
  if (await fs.pathExists(ASSET_DEFAULT_IGNORE)) {
    const managedPatterns = await fs.readFile(ASSET_DEFAULT_IGNORE, "utf-8");
    await fs.writeFile(HOME_DEFAULT_IGNORE, managedPatterns);
  }

  // Synchronize Default Prompts (Only copy if missing to preserve user edits)
  if (await fs.pathExists(ASSET_PROMPTS)) {
    const assetPrompts = await fs.readdir(ASSET_PROMPTS);
    for (const promptFile of assetPrompts) {
      const assetPromptPath = path.join(ASSET_PROMPTS, promptFile);
      const userPromptPath = path.join(HOME_PROMPTS, promptFile);
      const stat = await fs.stat(assetPromptPath);
      if (stat.isFile() && !(await fs.pathExists(userPromptPath))) {
        await fs.copy(assetPromptPath, userPromptPath);
      }
    }
  }

  // Initialize User Global Ignore if missing
  if (!(await fs.pathExists(HOME_IGNORE))) {
    const userIgnoreTemplate = [
      "# Spekta User Global Ignore",
      "# Patterns here apply to all projects.",
      "",
    ].join("\n");
    await fs.writeFile(HOME_IGNORE, userIgnoreTemplate);
    console.log("Created user global .spektaignore file");
  }
};
