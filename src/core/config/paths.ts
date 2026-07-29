import fs from "fs-extra";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Robust ASSET_ROOT resolution for compiled distributions
export const getAssetRoot = () => {
  if (process.env.SPEKTA_ASSET_ROOT_OVERRIDE) {
    return process.env.SPEKTA_ASSET_ROOT_OVERRIDE;
  }
  // Try 1 level up (e.g., if inside dist/ and templates is inside dist/)
  const root1 = path.resolve(__dirname, "..", "..");
  if (fs.existsSync(path.join(root1, "templates"))) {
    return root1;
  }
  // Try 2 levels up (e.g., if inside src/core/ and templates is in project root)
  const root2 = path.resolve(__dirname, "../../..");
  if (fs.existsSync(path.join(root2, "templates"))) {
    return root2;
  }
  return path.resolve(__dirname, "../../../../"); // Fallback for nested dist structures
};

export const getAssetPaths = () => ({
  ASSET_PROMPTS: path.join(getAssetRoot(), "templates", "prompts"),
  ASSET_TOOLS: path.join(getAssetRoot(), "templates", "tools"),
  ASSET_DEFAULT_IGNORE: path.join(
    getAssetRoot(),
    "templates",
    "default.ignore",
  ),
});

export const GET_HOME_DIR = () =>
  process.env.SPEKTA_HOME_OVERRIDE || path.join(os.homedir(), ".spekta");

// Ensure HOME_DIR is not cached until env is loaded
export let HOME_DIR: string;
export let HOME_PROVIDERS_USER: string;
export let HOME_PROVIDERS_FREE: string;
export let HOME_PROMPTS: string;
export let HOME_DEFAULT_IGNORE: string;
export let HOME_IGNORE: string;
export let HOME_TOOLS: string;

export const refreshPaths = () => {
  HOME_DIR = GET_HOME_DIR();
  HOME_DEFAULT_IGNORE = path.join(HOME_DIR, ".spektadefaultignore");
  HOME_PROVIDERS_USER = path.join(HOME_DIR, "providers.yaml");
  HOME_PROVIDERS_FREE = path.join(HOME_DIR, "providers-free.yaml");
  HOME_PROMPTS = path.join(HOME_DIR, "prompts");
  HOME_IGNORE = path.join(HOME_DIR, ".spektaignore");
  HOME_TOOLS = path.join(HOME_DIR, "tools");
};

// Initialize once at load, but allow bootstrap to override
refreshPaths();
