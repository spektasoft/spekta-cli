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

export async function runRepl() {
  const env = await getEnv();
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is missing.");
  }

  const { providers } = await getProviders();
  const systemPrompt = await getPromptContent("repl.md");

  const provider = await promptReplProviderSelection(systemPrompt, providers);

  const sessionId = generateSessionId();
  const messages: Message[] = [{ role: "system", content: systemPrompt }];

  Logger.info(`Starting REPL session: ${sessionId}`);

  let shouldAutoTriggerAI = false;
  let pendingToolResults = "";

  while (true) {
    if (!shouldAutoTriggerAI) {
      const userInput = await getUserMessage();

      if (userInput === null) continue;

      if (userInput.toLowerCase() === "exit") {
        // Best practice: if there are pending rejections, save them before exiting
        if (pendingToolResults) {
          messages.push({ role: "user", content: pendingToolResults });
          await saveSession(sessionId, messages);
        }
        break;
      }

      // Combine previous tool results (failures/rejections) with manual user input
      const finalMessageContent = pendingToolResults
        ? `${pendingToolResults}\n\n${userInput}`
        : userInput;

      pendingToolResults = ""; // Clear buffer
      messages.push({ role: "user", content: finalMessageContent });
      await saveSession(sessionId, messages);

      process.stdout.write(chalk.green.bold("\nYou:\n"));
      console.log(boxen(finalMessageContent, { borderColor: "green" }));
      process.stdout.write("\n");
    } else {
      // Automatic progression: Commit successful results before AI call
      messages.push({ role: "user", content: pendingToolResults });
      await saveSession(sessionId, messages);
      pendingToolResults = "";
      shouldAutoTriggerAI = false;
    }

    let assistantContent = "";
    let assistantReasoning = "";
    let success = false;
    let userInterrupted = false;

    while (!success && !userInterrupted) {
      const spinner = ora("Calling assistant...").start();
      const controller = new AbortController();

      const handleInterrupt = () => {
        userInterrupted = true;
        controller.abort();
      };

      process.on("SIGINT", handleInterrupt);

      try {
        const stream = await callAIStream(
          env.OPENROUTER_API_KEY,
          provider.model,
          messages,
          provider.config ?? {},
          undefined,
          controller.signal,
        );

        // Note: spinner.stop() is moved inside the stream consumption to
        // ensure it stays visible until the first token arrives.

        let isThinking = false;
        let firstTokenReceived = false;

        try {
          for await (const chunk of stream) {
            if (!firstTokenReceived) {
              spinner.stop();
              process.stdout.write(chalk.cyan.bold("Assistant:\n"));
              process.stdout.write(
                chalk.dim("  (Press Ctrl+C to interrupt)\n\n"),
              );
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
          success = true;
        } catch (streamError: any) {
          if (streamError.name === "AbortError") {
            process.stdout.write(
              chalk.yellow.bold("\n\n[Interrupted by user]\n"),
            );
          } else {
            throw streamError; // Rethrow to be caught by the outer retry handler
          }
        }
      } catch (error: any) {
        spinner.fail(`AI call failed: ${error.message}`);

        // Check if we should offer retry (only if not interrupted)
        if (!userInterrupted) {
          const retryChoice = await select({
            message: "AI service unavailable. What would you like to do?",
            choices: [
              { name: "Retry", value: "retry" },
              { name: "Exit REPL", value: "exit" },
            ],
          });

          if (retryChoice === "exit") return;
        }
      } finally {
        spinner.stop();
        process.off("SIGINT", handleInterrupt);
        process.stdout.write(chalk.reset(""));
      }
    }

    // Only save if we actually received some content or reasoning
    if (assistantContent || assistantReasoning) {
      if (userInterrupted) {
        assistantContent =
          assistantContent.trim() + "... (interrupted by user).";
      }

      messages.push({
        role: "assistant",
        content: assistantContent,
        reasoning: assistantReasoning || undefined,
      });

      await saveSession(sessionId, messages);
    }

    // Reset loop state
    if (userInterrupted) {
      shouldAutoTriggerAI = false;
      continue; // Jump to next user input
    }

    const toolCalls = parseToolCalls(assistantContent);
    if (toolCalls.length > 0) {
      // Ensure we aren't stuck in dimmed style if the model went straight to tools
      process.stdout.write(chalk.reset(""));

      console.log(
        boxen(
          toolCalls
            .map((c, i) => `${i + 1}. [${c.type.toUpperCase()}] ${c.path}`)
            .join("\n"),
          {
            title: "Proposed Tools",
            borderColor: "cyan",
            dimBorder: true,
          },
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
        pendingToolResults = toolResults.join("\n\n");
        process.stdout.write("\n");
        console.log(
          boxen(pendingToolResults, {
            title: "Tools Result",
            borderColor: "cyan",
          }),
        );

        if (hasAnyExecution) {
          shouldAutoTriggerAI = true;
          continue; // Jump to start of loop to commit results and hit AI
        }
      }
    }

    shouldAutoTriggerAI = false;
  }
}
