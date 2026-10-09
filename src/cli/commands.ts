import { runMcpServer } from "../api/mcp-server";
import { runCommit } from "../commands/commit";
import { runPromptRunner } from "../commands/prompt";
import { runCommitRange } from "../commands/commit-range";
import { runGrep } from "../commands/grep";
import { runRg } from "../commands/rg";
import { runPr } from "../commands/pr";
import { runRead } from "../commands/read";
import { runReadInteractive } from "../commands/read-interactive";
import { runRepl } from "../commands/repl";
import { runReplace } from "../commands/replace";
import { runReview } from "../commands/review";
import { runSummarize } from "../commands/summarize";
import { runSync } from "../commands/sync";
import { runWrite } from "../commands/write";
import { runDiagnostic } from "../commands/diagnostic";
import { runDiagnosticInteractive } from "../commands/diagnostic-interactive";
import { runRtkProxy } from "../commands/proxy";
import { searchableSelect } from "../ui/ui";
import { parseFilePathWithRange } from "../utils/read-utils";
import {
  runCodexSetup,
  runCodexStatus,
  runCodexUninstall,
} from "../commands/codex-setup";

export interface CommandDefinition {
  name: string;
  run: (args?: string[]) => Promise<void>;
  hidden?: boolean;
}

export const COMMANDS: Record<string, CommandDefinition> = {
  commit: {
    name: "Generate Commit Message",
    run: runCommit,
  },
  repl: {
    name: "Start Refactoring REPL",
    run: runRepl,
  },
  prompt: {
    name: "Run Composable Prompt",
    run: async (args?: string[]) => {
      await runPromptRunner(args || []);
    },
  },
  review: {
    name: "Run Git Review",
    run: runReview,
  },
  read: {
    name: "Read Files",
    run: async (args?: string[]) => {
      const safeArgs = args || [];
      const fileArgs = safeArgs.filter((arg) => arg !== "--save");
      const isSave = safeArgs.includes("--save");

      if (fileArgs.length === 0) {
        await runReadInteractive();
      } else {
        const requests = fileArgs.map((arg) => parseFilePathWithRange(arg));
        await runRead(requests, { save: isSave });
      }
    },
  },
  grep: {
    name: "Search Project (ripgrep)",
    run: runGrep,
    hidden: true,
  },
  rg: {
    name: "Search Project (ripgrep)",
    run: runRg,
  },
  diagnostic: {
    name: "Run Diagnostics",
    run: async (args?: string[]) => {
      const safeArgs = args || [];
      if (safeArgs.includes("--interactive")) {
        await runDiagnosticInteractive();
        return;
      }
      await runDiagnostic(safeArgs);
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
  setup: {
    name: "Preview Codex Setup",
    run: runCodexSetup,
    hidden: true,
  },
  uninstall: {
    name: "Uninstall Codex Integration",
    run: runCodexUninstall,
    hidden: true,
  },
  status: {
    name: "Show Codex Integration Status",
    run: runCodexStatus,
    hidden: true,
  },
};

export async function dispatchCommand(
  commandArg: string,
  args: string[],
): Promise<void> {
  const command = COMMANDS[commandArg];

  if (command) {
    await command.run(args);
    return;
  }

  await runRtkProxy(commandArg, args);
}

export async function runInteractiveMenu(): Promise<void> {
  const choices = Object.entries(COMMANDS)
    .filter(([, definition]) => !definition.hidden)
    .map(([key, definition]) => ({
      name: definition.name,
      value: key,
    }));

  const action = await searchableSelect<string>("What would you like to do?", [
    ...choices,
    { name: "Exit", value: "exit" },
  ]);

  if (action === "exit" || !COMMANDS[action]) {
    return;
  }

  if (action === "commit" || action === "diagnostic") {
    await COMMANDS[action].run(["--interactive"]);
    return;
  }

  await COMMANDS[action].run();
}
