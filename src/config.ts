import dotenv from "dotenv";
import path from "path";
import os from "os";
import fs from "fs-extra";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME_DIR = path.join(os.homedir(), ".llm-sh");
const HOME_PROMPTS = path.join(HOME_DIR, "prompts");
const ASSET_PROMPTS = path.join(__dirname, "prompts");

export const bootstrap = () => {
  fs.ensureDirSync(HOME_PROMPTS);

  if (fs.existsSync(ASSET_PROMPTS)) {
    const files = fs.readdirSync(ASSET_PROMPTS);
    for (const file of files) {
      const targetPath = path.join(HOME_PROMPTS, file);
      if (!fs.existsSync(targetPath)) {
        fs.copySync(path.join(ASSET_PROMPTS, file), targetPath);
      }
    }
  }
};

export const getEnv = () => {
  const workspaceEnv = path.join(process.cwd(), ".env");
  const homeEnv = path.join(HOME_DIR, ".env");
  if (fs.existsSync(workspaceEnv)) dotenv.config({ path: workspaceEnv });
  else if (fs.existsSync(homeEnv)) dotenv.config({ path: homeEnv });
  return process.env;
};

export const getProviders = async () => {
  const configPath = path.join(HOME_PROMPTS, "providers.json");
  return fs.readJSON(configPath);
};

export { HOME_PROMPTS };
