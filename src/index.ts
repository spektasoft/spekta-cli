import { searchableSelect } from "./ui";
import { runCommit } from "./commands/commit";
import { runCommitRange } from "./commands/commit-range";
import { runPlan } from "./commands/plan";
import { runPr } from "./commands/pr";
import { runRead } from "./commands/read";
import { runReadInteractive } from "./commands/read-interactive";
import { runReview } from "./commands/review";
import { runSummarize } from "./commands/summarize";
import { runSync } from "./commands/sync";
import { runReplace } from "./commands/replace";
import { runWrite } from "./commands/write";
import { bootstrap } from "./config";
import { runMcpServer } from "./mcp-server";
import { parseFilePathWithRange } from "./utils/read-utils";
import { runRepl } from "./commands/repl";

interface CommandDefinition {
  name: string;
  run: (args?: string[]) => Promise<void>;
  hidden?: boolean;
}

const COMMANDS: Record<string, CommandDefinition> = {
  commit: {
    name: "Generate Commit Message",
    run: runCommit,
  },
  repl: {
    name: "Start Refactoring REPL",
    run: runRepl,
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
    name: "Read Files",
    run: async (args: string[] = []) => {
      const fileArgs = args.filter((arg) => arg !== "--save");
      const isSave = args.includes("--save");

      if (fileArgs.length === 0) {
        await runReadInteractive();
      } else {
        const requests = fileArgs.map((arg) => parseFilePathWithRange(arg));
        await runRead(requests, { save: isSave });
      }
    },
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
  replace: {
    name: "Replace Code in File",
    run: runReplace,
    hidden: true,
  },
  write: {
    name: "Write New File (agent tool)",
    run: runWrite,
    hidden: true,
  },
  mcp: {
    name: "Start the MCP Server",
    run: runMcpServer,
    hidden: true,
  },
};

async function main() {
  await bootstrap();

  const args = process.argv.slice(2);
  const commandArg = args[0];

  // 1. Check CLI Arguments
  if (commandArg && COMMANDS[commandArg]) {
    await COMMANDS[commandArg].run(args.slice(1));
    return;
  }

  // 2. Fallback to Interactive Menu
  const choices = Object.entries(COMMANDS)
    .filter(([key, def]) => !def.hidden) // Hide commands marked as hidden
    .map(([key, def]) => ({
      name: def.name,
      value: key,
    }));

  const action = await searchableSelect<string>("What would you like to do?", [
    ...choices,
    { name: "Exit", value: "exit" },
  ]);

  if (action !== "exit" && COMMANDS[action]) {
    await COMMANDS[action].run();
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
