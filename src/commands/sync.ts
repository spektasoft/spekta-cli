import { getEnv, syncFreeModels } from "../config";
import ora from "ora";

export async function runSync() {
  const env = await getEnv();
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY not found in environment.");
  }

  const spinner = ora("Fetching models...").start();
  try {
    const count = await syncFreeModels(env.OPENROUTER_API_KEY);
    spinner.succeed(`Successfully synced ${count} free models.`);
  } catch (err: any) {
    spinner.fail(`Sync failed: ${err.message}`);
    throw err;
  }
}
