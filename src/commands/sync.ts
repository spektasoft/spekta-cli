import { getEnv } from "../core/config";
import { syncFreeModels } from "../adapters/sync/freeModels";
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    spinner.fail(`Sync failed: ${message}`);
    throw err;
  }
}
