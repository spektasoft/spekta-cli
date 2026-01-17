import dotenv from "dotenv";
import path from "path";
import os from "os";
import fs from "fs-extra";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface Provider {
  name: string;
  model: string;
  config?: Record<string, any>;
}

// Update ProvidersConfig to handle potential undefined
interface ProvidersConfig {
  providers: Provider[];
}

export interface OpenRouterModel {
  id: string;
  name: string;
  pricing: {
    prompt: string;
    completion: string;
    request: string;
  };
}

const GET_HOME_DIR = () =>
  process.env.SPEKTA_HOME_OVERRIDE || path.join(os.homedir(), ".spekta");

export let HOME_DIR = GET_HOME_DIR();
export const HOME_PROVIDERS_USER = path.join(HOME_DIR, "providers.json");
export const HOME_PROVIDERS_FREE = path.join(HOME_DIR, "providers-free.json");
export let HOME_PROMPTS = path.join(HOME_DIR, "prompts");
const ASSET_ROOT = __dirname;
const ASSET_PROMPTS = path.join(ASSET_ROOT, "prompts");
const HOME_IGNORE = path.join(HOME_DIR, ".spektaignore");

export const refreshPaths = () => {
  HOME_DIR = GET_HOME_DIR();
  HOME_PROMPTS = path.join(HOME_DIR, "prompts");
};

export const bootstrap = async () => {
  await fs.ensureDir(HOME_DIR);
  await fs.ensureDir(HOME_PROMPTS);

  if (!(await fs.pathExists(HOME_IGNORE))) {
    const defaultIgnores = [
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "composer.lock",
      "Gemfile.lock",
      "Cargo.lock",
      "mix.lock",
    ].join("\n");
    await fs.writeFile(HOME_IGNORE, defaultIgnores);
  }
};

export const getPromptContent = async (fileName: string): Promise<string> => {
  const userPath = path.join(HOME_PROMPTS, fileName);
  const internalPath = path.join(ASSET_PROMPTS, fileName);

  if (await fs.pathExists(userPath)) {
    return fs.readFile(userPath, "utf-8");
  }

  if (await fs.pathExists(internalPath)) {
    return fs.readFile(internalPath, "utf-8");
  }

  throw new Error(`Prompt template not found: ${fileName}.`);
};

export const getEnv = async () => {
  const workspaceEnv = path.join(process.cwd(), ".env");
  const homeEnv = path.join(HOME_DIR, ".env");
  if (await fs.pathExists(workspaceEnv)) dotenv.config({ path: workspaceEnv });
  else if (await fs.pathExists(homeEnv)) dotenv.config({ path: homeEnv });
  return process.env;
};

export const getIgnorePatterns = async (): Promise<string[]> => {
  const workspaceIgnore = path.join(process.cwd(), ".spektaignore");
  const targetFile = (await fs.pathExists(workspaceIgnore))
    ? workspaceIgnore
    : HOME_IGNORE;

  if (!(await fs.pathExists(targetFile))) return [];

  const content = await fs.readFile(targetFile, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
};

export const getProviders = async (): Promise<ProvidersConfig> => {
  const configPath = path.join(HOME_DIR, "providers.json");
  if (!(await fs.pathExists(configPath))) {
    throw new Error(`Providers config not found at ${configPath}.`);
  }
  return fs.readJSON(configPath);
};
