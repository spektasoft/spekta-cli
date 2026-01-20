import { select } from "@inquirer/prompts";
import { runCommit } from "./commands/commit";
import { runCommitRange } from "./commands/commit-range";
import { runPlan } from "./commands/plan";
import { runPr } from "./commands/pr";
import { runReview } from "./commands/review";
import { runSummarize } from "./commands/summarize";
import { runSync } from "./commands/sync";
import { runReadInteractive } from "./commands/read-interactive";
import { runRead } from "./commands/read";
import { bootstrap } from "./config";

interface CommandDefinition {
  name: string;
  run: (...args: any[]) => Promise<void>;
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
  read: {
    name: "Read File (AI Tool)",
    run: runReadInteractive,
  },
  pr: {
    name: "Generate PR Message",
    run: runPr,
  },
  "commit-range": {
    name: "Generate Commit Message from Range",
    run: runCommitRange,
  },
  summarize: {
    name: "Generate Summary from Commit Range",
    run: runSummarize,
  },
  sync: {
    name: "Sync Free Models",
    run: runSync,
  },
};

async function main() {
  await bootstrap();

  const args = process.argv.slice(2);
  const commandArg = args[0];

  // 1. Check CLI Arguments
  if (commandArg === "read") {
    const filePath = args[1];
    const range = args[2] === "--save" ? undefined : args[2];
    const isSave = args.includes("--save");
    await runRead(filePath, range, { save: isSave });
    return;
  }

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
