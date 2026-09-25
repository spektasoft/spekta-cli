import chalk from "chalk";
import { Message } from "../api/api";
import { getPromptContent, getProviders } from "../core/config";
import { Provider } from "../core/config/types";
import { promptReplProviderSelection } from "../ui/repl";
import { Logger } from "../utils/logger";
import { generateSessionId, saveSession } from "../utils/session-utils";
import { SessionRunner } from "./repl/session-runner";

export class ReplSession {
  private sessionId: string;
  private messages: Message[] = [];
  private provider: Provider | null = null;
  private systemPrompt: string = "";
  private runner: SessionRunner | null = null;
  private boundHandleInterrupt: (() => void) | undefined;

  constructor() {
    this.sessionId = generateSessionId();
  }

  public async initialize(): Promise<void> {
    const { providers } = await getProviders();
    this.systemPrompt = await getPromptContent("repl.md");

    this.provider = await promptReplProviderSelection(
      this.systemPrompt,
      providers,
    );
    this.messages = [{ role: "system", content: this.systemPrompt }];
    await saveSession(this.sessionId, this.messages);

    Logger.info(`Starting REPL session: ${this.sessionId}`);
  }

  private cleanup() {
    if (this.boundHandleInterrupt) {
      process.off("SIGINT", this.boundHandleInterrupt);
    }
    process.stdout.write(chalk.reset(""));
  }

  public async start(): Promise<void> {
    try {
      await this.initialize();
      if (!this.provider) {
        throw new Error("REPL session provider is not initialized");
      }

      this.runner = new SessionRunner(
        this.sessionId,
        this.provider,
        this.messages,
      );

      this.boundHandleInterrupt = () => {
        void this.runner?.interrupt().catch((err: unknown) => {
          console.error("Failed to shutdown gracefully:", err);
          process.exit(1);
        });
      };
      process.on("SIGINT", this.boundHandleInterrupt);

      await this.runner.start();
    } finally {
      this.cleanup();
    }
  }
}

export async function runRepl(): Promise<void> {
  const session = new ReplSession();
  await session.start();
}
