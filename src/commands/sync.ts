import { getEnv, syncFreeModels } from "../config";
import ora from "ora";

export async function runSync() {
  const env = await getEnv();
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY not found in environment.");
  }

  const spinner = ora("Syncing free models from OpenRouter...").start();
  try {
    await syncFreeModels(env.OPENROUTER_API_KEY);
    spinner.succeed("Free models updated successfully.");
  } catch (err: any) {
    spinner.fail(`Sync failed: ${err.message}`);
  }
}
