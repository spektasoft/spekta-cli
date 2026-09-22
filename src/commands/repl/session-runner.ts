import boxen from "boxen";
import chalk from "chalk";
import ora from "ora";
import { select } from "@inquirer/prompts";
import { callAIStreamWithProvider, Message } from "../../api/api";
import { Provider } from "../../core/config/types";
import { getUserMessage } from "../../utils/multiline-input";
import { saveSession } from "../../utils/session-utils";
import { consumeAssistantStream } from "./stream-consumer";
import { coordinateToolCalls } from "./tool-pipeline";

export class SessionRunner {
  private sessionId: string;
  private provider: Provider;
  private messages: Message[];
  private pendingToolResults: string = "";
  private shouldAutoTriggerAI: boolean = false;
  private isUserInterrupted: boolean = false;
  private currentAbortController: AbortController | null = null;
  private lastAssistantContent: string = "";
  private exitRequested: boolean = false;

  constructor(
    sessionId: string,
    provider: Provider,
    initialMessages: Message[] = [],
  ) {
    this.sessionId = sessionId;
    this.provider = provider;
    this.messages = [...initialMessages];
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public getMessages(): Message[] {
    return [...this.messages];
  }

  public requestExit() {
    this.exitRequested = true;
  }

  public async interrupt() {
    if (this.currentAbortController) {
      this.isUserInterrupted = true;
      this.currentAbortController.abort();
      process.stdout.write(chalk.yellow.bold("\n[Stream Interrupted]\n"));
      return;
    } else {
      this.exitRequested = true;
      process.stdout.write(chalk.yellow.bold("\n[Exiting REPL...]\n"));
      if (this.pendingToolResults) {
        this.messages.push({ role: "user", content: this.pendingToolResults });
        await saveSession(this.sessionId, this.messages);
      }
      process.exit(0);
    }
  }

  public async start() {
    while (!this.exitRequested) {
      if (!this.shouldAutoTriggerAI) {
        const shouldContinue = await this.handleUserTurn();
        if (!shouldContinue || this.exitRequested) break;
      } else {
        this.messages.push({
          role: "user",
          content: this.pendingToolResults,
        });
        await saveSession(this.sessionId, this.messages);
        this.pendingToolResults = "";
        this.shouldAutoTriggerAI = false;
      }

      await this.handleAssistantTurn();
      this.isUserInterrupted = false;
    }

    if (this.pendingToolResults) {
      this.messages.push({ role: "user", content: this.pendingToolResults });
      await saveSession(this.sessionId, this.messages);
    }
  }

  private async handleUserTurn(): Promise<boolean> {
    const userInput = await getUserMessage();

    if (userInput.toLowerCase() === "exit") {
      if (this.pendingToolResults) {
        this.messages.push({ role: "user", content: this.pendingToolResults });
        await saveSession(this.sessionId, this.messages);
      }
      return false;
    }

    const finalMessageContent = this.pendingToolResults
      ? `${this.pendingToolResults}\n\n${userInput}`
      : userInput;

    this.pendingToolResults = "";
    this.messages.push({ role: "user", content: finalMessageContent });
    await saveSession(this.sessionId, this.messages);

    process.stdout.write(chalk.green.bold("\nYou:\n"));
    console.log(boxen(finalMessageContent, { borderColor: "green" }));
    process.stdout.write("\n");

    return true;
  }

  private async handleAssistantTurn() {
    let assistantContent = "";
    let assistantReasoning = "";
    let success = false;
    this.isUserInterrupted = false;

    while (!success && !this.isUserInterrupted && !this.exitRequested) {
      const spinner = ora("Calling assistant...\n").start();
      const controller = new AbortController();
      this.currentAbortController = controller;

      try {
        const stream = await callAIStreamWithProvider(
          this.provider,
          this.messages,
          this.provider.config ?? {},
          undefined,
          controller.signal,
        );

        const result = await consumeAssistantStream(stream, { spinner });
        assistantContent = result.content;
        assistantReasoning = result.reasoning;

        if (result.interrupted) {
          this.isUserInterrupted = true;
        } else {
          success = true;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        spinner.fail(`AI call failed: ${message}`);
        if (!this.isUserInterrupted) {
          assistantContent = "";
          assistantReasoning = "";
          this.lastAssistantContent = "";
          const retryChoice = await select({
            message: "AI service unavailable. What would you like to do?",
            choices: [
              { name: "Retry", value: "retry" },
              { name: "Exit REPL", value: "exit" },
            ],
          });
          if (retryChoice === "exit") {
            this.exitRequested = true;
            return;
          }
        }
      } finally {
        this.currentAbortController = null;
        spinner.stop();
      }
    }

    await this.commitAssistantMessage(assistantContent, assistantReasoning);
    this.lastAssistantContent = assistantContent;

    if (this.isUserInterrupted || this.exitRequested) {
      this.shouldAutoTriggerAI = false;
      return;
    }

    const toolResult = await coordinateToolCalls(
      this.lastAssistantContent,
      this.isUserInterrupted,
    );
    this.pendingToolResults = toolResult.pendingToolResults;
    this.shouldAutoTriggerAI = toolResult.shouldAutoTriggerAI;
  }

  private async commitAssistantMessage(content: string, reasoning: string) {
    let finalContent = content;
    let finalReasoning = reasoning || "";

    if (this.isUserInterrupted) {
      if (content.trim() !== "") {
        finalContent = content.trim() + "\n\n[Response interrupted by user]";
      }
      if (content.trim() === "" && reasoning.trim() === "") {
        finalReasoning = "[INTERRUPTED BEFORE TOKENS ARRIVED]";
      } else if (!reasoning.includes("[INTERRUPTED]")) {
        finalReasoning =
          finalReasoning.trim() +
          (finalReasoning.trim() ? "\n" : "") +
          "[INTERRUPTED DURING STREAMING]";
      }
    }

    this.messages.push({
      role: "assistant",
      content: finalContent,
      reasoning: finalReasoning || undefined,
    });

    await saveSession(this.sessionId, this.messages);
  }
}
