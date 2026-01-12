import dotenv from "dotenv";
import path from "path";
import os from "os";
import fs from "fs-extra";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME_DIR = path.join(os.homedir(), ".llm-sh");
const HOME_PROMPTS = path.join(HOME_DIR, "prompts");
const ASSET_ROOT = __dirname; // Points to dist/ in production
const HOME_IGNORE = path.join(HOME_DIR, ".llmignore");

export const bootstrap = () => {
  fs.ensureDirSync(HOME_DIR);
  fs.ensureDirSync(HOME_PROMPTS);

  // Define files/folders to sync from templates to HOME_DIR
  const templateItems = ["prompts", "providers.json"];

  for (const item of templateItems) {
    const assetPath = path.join(ASSET_ROOT, item);
    const targetPath = path.join(HOME_DIR, item);

    if (fs.existsSync(assetPath)) {
      if (!fs.existsSync(targetPath)) {
        // Use copySync with overwrite: false to ensure we never touch existing user files
        fs.copySync(assetPath, targetPath, { overwrite: false });
      }
    }
  }

  if (!fs.existsSync(HOME_IGNORE)) {
    const defaultIgnores = [
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "composer.lock",
      "Gemfile.lock",
      "Cargo.lock",
      "mix.lock",
    ].join("\n");
    fs.writeFileSync(HOME_IGNORE, defaultIgnores);
  }
};

export const getEnv = () => {
  const workspaceEnv = path.join(process.cwd(), ".env");
  const homeEnv = path.join(HOME_DIR, ".env");
  if (fs.existsSync(workspaceEnv)) dotenv.config({ path: workspaceEnv });
  else if (fs.existsSync(homeEnv)) dotenv.config({ path: homeEnv });
  return process.env;
};

export const getIgnorePatterns = (): string[] => {
  const workspaceIgnore = path.join(process.cwd(), ".llmignore");
  const targetFile = fs.existsSync(workspaceIgnore)
    ? workspaceIgnore
    : HOME_IGNORE;

  if (!fs.existsSync(targetFile)) return [];

  return fs
    .readFileSync(targetFile, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
};

export const getProviders = async () => {
  const configPath = path.join(HOME_DIR, "providers.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`Providers config not found at ${configPath}`);
  }
  return fs.readJSON(configPath);
};

export { HOME_PROMPTS };
