import dotenv from "dotenv";
import fs from "fs-extra";
import path from "path";
import { GET_HOME_DIR } from "./paths.js";

let envLoaded = false;

/**
 * Resets internal module state.
 * Primarily used for the test suite to ensure clean state between runs.
 */
export const resetInternalState = (resetToolsCallback?: () => void) => {
  envLoaded = false;
  if (resetToolsCallback) {
    resetToolsCallback();
  }
};

export const getEnv = async () => {
  if (envLoaded) return process.env;

  const workspaceEnv = path.join(process.cwd(), ".env");
  const homeEnv = path.join(GET_HOME_DIR(), ".env");

  let globalConfig = {};
  if (await fs.pathExists(homeEnv)) {
    globalConfig = dotenv.parse(await fs.readFile(homeEnv, "utf-8"));
  }

  let localConfig = {};
  if (await fs.pathExists(workspaceEnv)) {
    localConfig = dotenv.parse(await fs.readFile(workspaceEnv, "utf-8"));
  }

  // Priority: Local > Global
  const mergedConfig = { ...globalConfig, ...localConfig };

  // Apply to process.env only if not already set (Shell priority)
  for (const [key, value] of Object.entries(mergedConfig)) {
    if (process.env[key] === undefined) {
      process.env[key] = value as string;
    }
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
