import dotenv from "dotenv";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { readYaml } from "./utils/yaml";

export interface Provider {
  name: string;
  model: string;
  config?: Record<string, any>;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
export let HOME_PROVIDERS_USER = path.join(HOME_DIR, "providers.yaml");
export let HOME_PROVIDERS_FREE = path.join(HOME_DIR, "providers-free.yaml");
export let HOME_PROMPTS = path.join(HOME_DIR, "prompts");
export let HOME_IGNORE = path.join(HOME_DIR, ".spektaignore");

const ASSET_ROOT = __dirname;
const ASSET_PROMPTS = path.join(ASSET_ROOT, "prompts");

export const refreshPaths = () => {
  HOME_DIR = GET_HOME_DIR();
  HOME_PROVIDERS_USER = path.join(HOME_DIR, "providers.yaml");
  HOME_PROVIDERS_FREE = path.join(HOME_DIR, "providers-free.yaml");
  HOME_PROMPTS = path.join(HOME_DIR, "prompts");
  HOME_IGNORE = path.join(HOME_DIR, ".spektaignore");
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
    console.log("Created default .spektaignore file");
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

let envLoaded = false;

export const getEnv = async () => {
  if (envLoaded) return process.env;

  const workspaceEnv = path.join(process.cwd(), ".env");
  const homeEnv = path.join(HOME_DIR, ".env");

  const envPath = (await fs.pathExists(workspaceEnv))
    ? workspaceEnv
    : (await fs.pathExists(homeEnv))
      ? homeEnv
      : null;

  if (envPath) {
    dotenv.config({ path: envPath, quiet: true });
  }

  envLoaded = true;
  return process.env;
};

export function getEnvValue(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Environment variable ${key} is required`);
  }
  return value;
}

export function getReadTokenLimit(): number {
  const raw = getEnvValue("SPEKTA_READ_TOKEN_LIMIT", "1000");
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed <= 0) {
    console.warn(
      `Invalid SPEKTA_READ_TOKEN_LIMIT value "${raw}", falling back to 1000`,
    );
    return 1000;
  }
  return parsed;
}

export function getCompactThreshold(): number {
  const raw = getEnvValue("SPEKTA_COMPACT_THRESHOLD", "500");
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 0) {
    console.warn(
      `Invalid SPEKTA_COMPACT_THRESHOLD value "${raw}", falling back to 500`,
    );
    return 500;
  }
  return parsed;
}

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
  const env = await getEnv();
  const disableFree = env.SPEKTA_DISABLE_FREE_MODELS === "true";

  const safeRead = async (filePath: string): Promise<ProvidersConfig> => {
    try {
      const data = await readYaml<ProvidersConfig>(filePath);
      return data || { providers: [] };
    } catch (err: any) {
      console.warn(`Warning: ${err.message}`);
      return { providers: [] };
    }
  };

  const [userRes, freeRes] = await Promise.allSettled([
    safeRead(HOME_PROVIDERS_USER),
    !disableFree
      ? safeRead(HOME_PROVIDERS_FREE)
      : Promise.resolve({ providers: [] }),
  ]);

  const userProviders: Provider[] =
    userRes.status === "fulfilled" ? userRes.value.providers : [];
  const freeProviders: Provider[] =
    freeRes.status === "fulfilled" ? freeRes.value.providers : [];

  const providers = [...userProviders, ...freeProviders];
  if (providers.length === 0) {
    console.warn(
      "Notice: No providers configured. Run 'spekta sync' to fetch free models.",
    );
  }

  return { providers };
};
