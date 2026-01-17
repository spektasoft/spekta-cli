import dotenv from "dotenv";
import path from "path";
import os from "os";
import fs from "fs-extra";
import { fileURLToPath } from "url";
import { fetchFreeModels } from "./api";

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
    console.log("Created default .spektaignore file");
  }

  if (!(await fs.pathExists(HOME_PROVIDERS_FREE))) {
    const env = await getEnv();
    if (env.OPENROUTER_API_KEY) {
      try {
        await syncFreeModels(env.OPENROUTER_API_KEY);
        console.log("Fetched free models from OpenRouter");
      } catch (e: any) {
        console.warn("Failed to fetch free models:", e.message);
        // Silent fail on bootstrap to prevent blocking CLI usage
      }
    } else {
      console.warn(
        "Warning: OPENROUTER_API_KEY not found. Free models won't be fetched."
      );
    }
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
  const env = await getEnv();
  const disableFree = env.SPEKTA_DISABLE_FREE_MODELS === "true";

  const [userRes, freeRes] = await Promise.allSettled([
    fs.readJSON(HOME_PROVIDERS_USER).catch((err) => {
      console.warn(
        `Warning: Failed to read user providers file: ${err.message}`
      );
      return { providers: [] };
    }),
    !disableFree
      ? fs.readJSON(HOME_PROVIDERS_FREE).catch((err) => {
          console.warn(
            `Warning: Failed to read free providers file: ${err.message}`
          );
          return { providers: [] };
        })
      : Promise.resolve({ providers: [] }),
  ]);

  const userProviders: Provider[] =
    userRes.status === "fulfilled" ? userRes.value.providers : [];
  const freeProviders: Provider[] =
    freeRes.status === "fulfilled" ? freeRes.value.providers : [];

  const mergedMap = new Map<string, Provider>();

  // Free providers added first
  freeProviders.forEach((p) => {
    if (p.model) {
      mergedMap.set(p.model, p);
    } else {
      console.warn("Warning: Skipping provider without model ID:", p);
    }
  });

  // User providers overwrite free providers
  userProviders.forEach((p) => {
    if (p.model) {
      mergedMap.set(p.model, p);
    } else {
      console.warn("Warning: Skipping provider without model ID:", p);
    }
  });

  const providers = Array.from(mergedMap.values());
  if (providers.length === 0) {
    console.warn(
      "Notice: No providers configured. Run 'spekta sync' to fetch free models."
    );
  }

  return { providers };
};

export const syncFreeModels = async (apiKey: string) => {
  const models = await fetchFreeModels(apiKey);
  const providers: Provider[] = models.map((m) => ({
    name: `[Free] ${m.name}`,
    model: m.id,
  }));
  await fs.writeJSON(HOME_PROVIDERS_FREE, { providers }, { spaces: 2 });
};
