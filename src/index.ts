import fs from "fs-extra";
import { syncFreeModels } from "./adapters/sync/freeModels";
import { bootstrap, getEnv, HOME_PROVIDERS_FREE } from "./core/config";
import { COMMANDS, dispatchCommand, runInteractiveMenu } from "./cli/commands";

export { COMMANDS };

async function main() {
  const args = process.argv.slice(2);
  const commandArg = args[0];
  const isInteractiveMenu = args.length === 0;
  await bootstrap({ writeUserHome: isInteractiveMenu });

  // Initial free models sync if file doesn't exist
  if (isInteractiveMenu && !(await fs.pathExists(HOME_PROVIDERS_FREE))) {
    const env = await getEnv();
    if (env.OPENROUTER_API_KEY) {
      try {
        await syncFreeModels(env.OPENROUTER_API_KEY);
      } catch (e: any) {
        console.error(
          "Notice: Initial model sync skipped (OpenRouter unreachable).",
        );
      }
    } else {
      console.error(
        "Warning: OPENROUTER_API_KEY not found. Free models won't be fetched.",
      );
    }
  }

  if (commandArg) {
    await dispatchCommand(commandArg, args.slice(1));
    return;
  }

  if (args.length !== 0) {
    return;
  }

  await runInteractiveMenu();
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
