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
export let HOME_PROVIDERS_USER = path.join(HOME_DIR, "providers.json");
export let HOME_PROVIDERS_FREE = path.join(HOME_DIR, "providers-free.json");
export let HOME_PROMPTS = path.join(HOME_DIR, "prompts");
export let HOME_IGNORE = path.join(HOME_DIR, ".spektaignore");

const ASSET_ROOT = __dirname;
const ASSET_PROMPTS = path.join(ASSET_ROOT, "prompts");

export const refreshPaths = () => {
  HOME_DIR = GET_HOME_DIR();
  HOME_PROVIDERS_USER = path.join(HOME_DIR, "providers.json");
  HOME_PROVIDERS_FREE = path.join(HOME_DIR, "providers-free.json");
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

  if (!(await fs.pathExists(HOME_PROVIDERS_FREE))) {
    const env = await getEnv();
    if (env.OPENROUTER_API_KEY) {
      try {
        await syncFreeModels(env.OPENROUTER_API_KEY);
      } catch (e: any) {
        console.warn(
          "Notice: Initial model sync skipped (OpenRouter unreachable).",
        );
      }
    } else {
      console.warn(
        "Warning: OPENROUTER_API_KEY not found. Free models won't be fetched.",
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

  const safeRead = async (filePath: string) => {
    if (!(await fs.pathExists(filePath))) return { providers: [] };
    try {
      return await fs.readJSON(filePath);
    } catch (err: any) {
      console.warn(
        `Warning: Failed to parse ${path.basename(filePath)}: ${err.message}`,
      );
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

  const mergedMap = new Map<string, Provider>();

  freeProviders.forEach((p) => p.model && mergedMap.set(p.model, p));
  userProviders.forEach((p) => p.model && mergedMap.set(p.model, p));

  const providers = Array.from(mergedMap.values());
  if (providers.length === 0) {
    console.warn(
      "Notice: No providers configured. Run 'spekta sync' to fetch free models.",
    );
  }

  return { providers };
};

export const syncFreeModels = async (apiKey: string) => {
  const models = await fetchFreeModels(apiKey);

  // Validate that we received valid models
  if (!models || !Array.isArray(models) || models.length === 0) {
    throw new Error("No free models found on OpenRouter.");
  }

  // Validate each model has required properties
  const validModels = models.filter(
    (m) => m && typeof m.id === "string" && typeof m.name === "string",
  );

  if (validModels.length === 0) {
    throw new Error("No valid free models found on OpenRouter.");
  }

  const providers: Provider[] = validModels.map((m) => ({
    name: `[Free] ${m.name}`,
    model: m.id,
  }));

  // Validate that we have providers to write
  if (providers.length === 0) {
    throw new Error("No valid providers could be created from the models.");
  }

  await fs.writeJSON(HOME_PROVIDERS_FREE, { providers }, { spaces: 2 });
  return providers.length;
};
