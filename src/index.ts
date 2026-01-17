import { bootstrap } from "./config";
import { runReview } from "./commands/review";
import { runCommit } from "./commands/commit";
import { select } from "@inquirer/prompts";
import { runPr } from "./commands/pr";
import { runPlan } from "./commands/plan";

interface CommandDefinition {
  name: string;
  run: () => Promise<void>;
}

const COMMANDS: Record<string, CommandDefinition> = {
  commit: {
    name: "Generate Commit Message",
    run: runCommit,
  },
  plan: {
    name: "Generate Implementation Plan",
    run: runPlan,
  },
  review: {
    name: "Run Git Review",
    run: runReview,
  },
  pr: {
    name: "Generate PR Message",
    run: runPr,
  },
};

async function main() {
  await bootstrap();

  const args = process.argv.slice(2);
  const commandArg = args[0];

  // 1. Check CLI Arguments
  if (commandArg && COMMANDS[commandArg]) {
    await COMMANDS[commandArg].run();
    return;
  }

  // 2. Fallback to Interactive Menu
  const action = await select({
    message: "What would you like to do?",
    choices: [
      ...Object.entries(COMMANDS).map(([value, def]) => ({
        name: def.name,
        value: value,
      })),
      { name: "Exit", value: "exit" },
    ],
  });

  if (action !== "exit" && COMMANDS[action]) {
    await COMMANDS[action].run();
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
