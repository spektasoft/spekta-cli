import { checkbox, select } from "@inquirer/prompts";
import boxen from "boxen";
import chalk from "chalk";
import ora from "ora";
import {
  callAIStream,
  ChatCompletionChunkWithReasoning,
  Message,
} from "../api";
import { getEnv, getPromptContent, getProviders } from "../config";
import { promptReplProviderSelection } from "../ui/repl";
import { executeTool, parseToolCalls } from "../utils/agent-utils";
import { Logger } from "../utils/logger";
import { getUserMessage } from "../utils/multiline-input";
import { generateSessionId, saveSession } from "../utils/session-utils";

export class ReplSession {
  private sessionId: string;
  private messages: Message[] = [];
  private env: any;
  private provider: any;
  private systemPrompt: string = "";
  private pendingToolResults: string = "";
  private shouldAutoTriggerAI: boolean = false;
  private isUserInterrupted: boolean = false;
  private currentAbortController: AbortController | null = null;
  private lastAssistantContent: string = "";
  private boundHandleInterrupt: (() => void) | undefined;
  private exitRequested: boolean = false;

  constructor() {
    this.sessionId = generateSessionId();
  }

  public async initialize() {
    this.env = await getEnv();
    if (!this.env.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is missing.");
    }

    const { providers } = await getProviders();
    this.systemPrompt = await getPromptContent("repl.md");

    this.provider = await promptReplProviderSelection(
      this.systemPrompt,
      providers,
    );
    this.messages = [{ role: "system", content: this.systemPrompt }];

    Logger.info(`Starting REPL session: ${this.sessionId}`);
  }

  private cleanup() {
    if (this.boundHandleInterrupt) {
      process.off("SIGINT", this.boundHandleInterrupt);
    }
    // Reset any global terminal state if necessary
    process.stdout.write(chalk.reset(""));
  }

  private handleInterrupt() {
    if (this.currentAbortController) {
      // Situation: AI is currently generating text
      // Action: Cancel the stream but allow the REPL to continue
      this.isUserInterrupted = true;
      this.currentAbortController.abort();
      process.stdout.write(chalk.yellow.bold("\n[Stream Interrupted]\n"));
    } else {
      // Situation: Application is idle/waiting for input
      // Action: Trigger a graceful exit
      this.exitRequested = true;
      process.stdout.write(chalk.yellow.bold("\n[Exiting REPL...]\n"));
    }
  }

  public async start() {
    try {
      await this.initialize();
      this.boundHandleInterrupt = this.handleInterrupt.bind(this);
      process.on("SIGINT", this.boundHandleInterrupt);

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

        // If we were interrupted during the assistant turn,
        // reset the flag for the next user input cycle.
        this.isUserInterrupted = false;
      }
    } finally {
      // Final state persistence for pending tools before shutdown
      if (this.pendingToolResults) {
        this.messages.push({ role: "user", content: this.pendingToolResults });
        await saveSession(this.sessionId, this.messages);
      }
      this.cleanup();
    }
  }

  private async handleUserTurn(): Promise<boolean> {
    const userInput = await getUserMessage();

    if (userInput === null) return true;

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

    while (!success && !this.isUserInterrupted) {
      const spinner = ora("Calling assistant...\n").start();
      const controller = new AbortController();
      this.currentAbortController = controller;

      try {
        const stream = await callAIStream(
          this.env.OPENROUTER_API_KEY,
          this.provider.model,
          this.messages,
          this.provider.config ?? {},
          undefined,
          controller.signal,
        );

        let isThinking = false;
        let firstTokenReceived = false;

        try {
          for await (const chunk of stream) {
            if (!firstTokenReceived) {
              spinner.stop();
              process.stdout.write(chalk.cyan.bold("Assistant:\n"));
              process.stdout.write(chalk.dim("(Press Ctrl+C to interrupt)\n"));
              firstTokenReceived = true;
            }

            const delta = (chunk as ChatCompletionChunkWithReasoning).choices[0]
              ?.delta;
            const reasoning = delta?.reasoning_details?.[0]?.text || "";
            const content = delta?.content || "";

            if (reasoning) {
              if (!isThinking) {
                process.stdout.write(
                  "\n" + chalk.cyan.italic.dim("Thought:\n"),
                );
                isThinking = true;
              }
              assistantReasoning += reasoning;
              process.stdout.write(chalk.italic.dim(reasoning));
            }

            if (content) {
              if (isThinking) {
                process.stdout.write(chalk.reset("\n\n"));
                isThinking = false;
              }
              assistantContent += content;
              process.stdout.write(content);
            }
          }
          // Added: Ensure the message is "closed" in the terminal
          process.stdout.write("\n\n");
          success = true;
        } catch (streamError: any) {
          if (streamError.name === "AbortError") {
            this.isUserInterrupted = true; // FIX: Break the loop on interrupt
            if (!firstTokenReceived) spinner.stop();
            process.stdout.write(
              chalk.yellow.bold("\n\n[Interrupted by user]\n"),
            );
          } else {
            throw streamError;
          }
        }
      } catch (error: any) {
        spinner.fail(`AI call failed: ${error.message}`);
        if (!this.isUserInterrupted) {
          // Reset the buffers on non-interruption failures
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
            return; // Exit the function to allow the main loop to handle cleanup
          }
        }
      } finally {
        if (this.currentAbortController) {
          this.currentAbortController = null;
        }
        // Only stop the spinner if it was never stopped by the first token
        spinner.stop();
      }
    }

    await this.commitAssistantMessage(assistantContent, assistantReasoning);
    this.lastAssistantContent = assistantContent;

    if (this.isUserInterrupted) {
      this.shouldAutoTriggerAI = false;
      return;
    }

    await this.handleToolCalls();
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
      } else if (
        this.isUserInterrupted &&
        !reasoning.includes("[INTERRUPTED]")
      ) {
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

  private async handleToolCalls() {
    let sanitizedContent = this.lastAssistantContent;
    if (this.isUserInterrupted) {
      // Use a precise marker match to avoid accidental content loss
      const marker = "\n\n[Response interrupted by user]";
      if (sanitizedContent.endsWith(marker)) {
        sanitizedContent = sanitizedContent.slice(0, -marker.length);
      }
    }

    const toolCalls = parseToolCalls(sanitizedContent);
    if (toolCalls.length === 0) {
      this.shouldAutoTriggerAI = false;
      return;
    }

    process.stdout.write(chalk.reset(""));
    console.log(
      boxen(
        toolCalls
          .map((c, i) => `${i + 1}. [${c.type.toUpperCase()}] ${c.path}`)
          .join("\n"),
        { title: "Proposed Tools", borderColor: "cyan", dimBorder: true },
      ),
    );

    const selectedTools = await checkbox({
      message: "Select tools to execute:",
      choices: toolCalls.map((c, i) => ({
        name: `${c.type}: ${c.path}`,
        value: i,
      })),
    });

    const toolResults: string[] = [];
    let hasAnyExecution = false;

    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];
      if (selectedTools.includes(i)) {
        try {
          const result = (await executeTool(call)).trim();
          toolResults.push(
            `### Tool: ${call.type} on ${call.path}\nStatus: Success\nOutput:\n${result}`,
          );
          hasAnyExecution = true;
          process.stdout.write(
            chalk.green(`✓ Executed ${call.type} on ${call.path}\n`),
          );
        } catch (err: any) {
          toolResults.push(
            `### Tool: ${call.type} on ${call.path}\nStatus: Error\n${err.message}`,
          );
          process.stdout.write(
            chalk.red(
              `✗ Failed ${call.type} on ${call.path}: ${err.message}\n`,
            ),
          );
        }
      } else {
        toolResults.push(
          `### Tool: ${call.type} on ${call.path}\nStatus: Denied by user`,
        );
      }
    }

    if (toolResults.length > 0) {
      this.pendingToolResults = toolResults.join("\n\n");
      process.stdout.write("\n");
      console.log(
        boxen(this.pendingToolResults, {
          title: "Tools Result",
          borderColor: "cyan",
        }),
      );

      if (hasAnyExecution) {
        this.shouldAutoTriggerAI = true;
      }
    }
  }
}

export async function runRepl() {
  const session = new ReplSession();
  await session.start();
}
