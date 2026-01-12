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

interface ProvidersConfig {
  providers: Provider[];
}

// Allow environment variable override for testing
const GET_HOME_DIR = () =>
  process.env.SPEKTA_HOME_OVERRIDE || path.join(os.homedir(), ".spekta");

export let HOME_DIR = GET_HOME_DIR();
export let HOME_PROMPTS = path.join(HOME_DIR, "prompts");
const ASSET_ROOT = __dirname;
const ASSET_PROMPTS = path.join(ASSET_ROOT, "prompts");
const HOME_IGNORE = path.join(HOME_DIR, ".llmignore");

/**
 * Updates the paths based on the current home directory logic.
 * Useful for testing when environment variables change.
 */
export const refreshPaths = () => {
  HOME_DIR = GET_HOME_DIR();
  HOME_PROMPTS = path.join(HOME_DIR, "prompts");
};

export const bootstrap = () => {
  fs.ensureDirSync(HOME_DIR);
  fs.ensureDirSync(HOME_PROMPTS);

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

/**
 * Resolves prompt content with fallback logic:
 * 1. Check ~/.spekta/prompts/filename
 * 2. Check internal package dist/filename
 */
export const getPromptContent = (fileName: string): string => {
  const userPath = path.join(HOME_PROMPTS, fileName);
  const internalPath = path.join(ASSET_PROMPTS, fileName);

  if (fs.existsSync(userPath)) {
    return fs.readFileSync(userPath, "utf-8");
  }

  if (fs.existsSync(internalPath)) {
    return fs.readFileSync(internalPath, "utf-8");
  }

  throw new Error(
    `Prompt template not found: ${fileName}. Searched in ${userPath} and ${internalPath}`
  );
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

export const getProviders = async (): Promise<ProvidersConfig> => {
  const configPath = path.join(HOME_DIR, "providers.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Providers config not found at ${configPath}. Please create it.`
    );
  }
  const data = await fs.readJSON(configPath);
  if (!data.providers || !Array.isArray(data.providers)) {
    throw new Error(
      "Invalid providers.json format: expected 'providers' array."
    );
  }
  return data as ProvidersConfig;
};
