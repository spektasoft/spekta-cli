import fs from "fs-extra";
import { getEnv } from "./env.js";
import {
  getAssetPaths,
  HOME_DIR,
  HOME_IGNORE,
  HOME_PROMPTS,
  HOME_TOOLS,
  refreshPaths,
} from "./paths.js";
import path from "path";

export interface BootstrapOptions {
  writeUserHome?: boolean;
}

export const bootstrap = async ({
  writeUserHome = true,
}: BootstrapOptions = {}) => {
  await getEnv();
  refreshPaths();

  const { ASSET_TOOLS } = getAssetPaths();

  // Asset Integrity Check
  if (!(await fs.pathExists(ASSET_TOOLS))) {
    throw new Error(
      `Critical Error: Internal tool templates not found at ${ASSET_TOOLS}`,
    );
  }

  if (!writeUserHome) {
    return;
  }

  await fs.ensureDir(HOME_DIR);
  await fs.ensureDir(HOME_PROMPTS);
  await fs.ensureDir(HOME_TOOLS);

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
