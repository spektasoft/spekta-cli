import fs from "fs-extra";
import path from "path";
import { getAssetPaths, HOME_IGNORE } from "./paths.js";

const parseIgnoreContent = (content: string): string[] => {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
};

export const getIgnorePatterns = async (): Promise<string[]> => {
  const patterns: string[] = [];

  // 1. Managed Defaults
  const { ASSET_DEFAULT_IGNORE } = getAssetPaths();
  if (await fs.pathExists(ASSET_DEFAULT_IGNORE)) {
    const managedContent = await fs.readFile(ASSET_DEFAULT_IGNORE, "utf-8");
    patterns.push(...parseIgnoreContent(managedContent));
  }

  // 2. User Global
  if (await fs.pathExists(HOME_IGNORE)) {
    const homeContent = await fs.readFile(HOME_IGNORE, "utf-8");
    patterns.push(...parseIgnoreContent(homeContent));
  }

  // 3. Workspace
  const workspaceIgnore = path.join(process.cwd(), ".spektaignore");
  if (await fs.pathExists(workspaceIgnore)) {
    const workspaceContent = await fs.readFile(workspaceIgnore, "utf-8");
    patterns.push(...parseIgnoreContent(workspaceContent));
  }

  return patterns;
};
