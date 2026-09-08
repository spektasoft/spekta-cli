import fs from "fs-extra";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Robust ASSET_ROOT resolution for compiled distributions
export const getAssetRoot = (): string => {
  if (process.env.SPEKTA_ASSET_ROOT_OVERRIDE) {
    return process.env.SPEKTA_ASSET_ROOT_OVERRIDE;
  }

  let current = __dirname;
  while (true) {
    const nestedTools = path.join(current, "templates", "tools");
    const flatTools = path.join(current, "tools");
    const flatPrompts = path.join(current, "prompts");

    if (
      fs.existsSync(nestedTools) ||
      (fs.existsSync(flatTools) && fs.existsSync(flatPrompts))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return path.resolve(__dirname, "..", "..");
};

export const getAssetPaths = () => {
  const root = getAssetRoot();

  const resolveSubpath = (subName: string): string => {
    const nestedPath = path.join(root, "templates", subName);
    const flatPath = path.join(root, subName);

    if (fs.existsSync(nestedPath)) {
      return nestedPath;
    }
    if (fs.existsSync(flatPath)) {
      return flatPath;
    }
    return nestedPath;
  };

  return {
    ASSET_PROMPTS: resolveSubpath("prompts"),
    ASSET_TOOLS: resolveSubpath("tools"),
    ASSET_DEFAULT_IGNORE: resolveSubpath("default.ignore"),
  };
};

export const GET_HOME_DIR = () =>
  process.env.SPEKTA_HOME_OVERRIDE || path.join(os.homedir(), ".spekta");

// Ensure HOME_DIR is not cached until env is loaded
export let HOME_DIR: string;
export let HOME_PROVIDERS_USER: string;
export let HOME_PROVIDERS_FREE: string;
export let HOME_PROMPTS: string;
export let HOME_IGNORE: string;
export let HOME_TOOLS: string;

export const refreshPaths = () => {
  HOME_DIR = GET_HOME_DIR();
  HOME_PROVIDERS_USER = path.join(HOME_DIR, "providers.yaml");
  HOME_PROVIDERS_FREE = path.join(HOME_DIR, "providers-free.yaml");
  HOME_PROMPTS = path.join(HOME_DIR, "prompts");
  HOME_IGNORE = path.join(HOME_DIR, ".spektaignore");
  HOME_TOOLS = path.join(HOME_DIR, "tools");
};

// Initialize once at load, but allow bootstrap to override
refreshPaths();
