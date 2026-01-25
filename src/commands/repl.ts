import { checkbox, select } from "@inquirer/prompts";
import boxen from "boxen";
import chalk from "chalk";
import ora from "ora";
import { callAIStream, Message } from "../api";
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

      if (userInput === null) {
        // cancelled → just loop again
        continue;
      }

      if (userInput.toLowerCase() === "exit") {
        // Best practice: if there are pending rejections, save them before exiting
        if (pendingToolResults) {
          messages.push({ role: "user", content: pendingToolResults });
          await saveSession(sessionId, messages);
        }
        break;
      }

      if (userInput.trim() === "") {
        continue; // safety net – should not happen
      }

      // Prepend pending tool results if they exist
      const finalMessageContent = pendingToolResults
        ? `${pendingToolResults}\n\n${userInput}`
        : userInput;

      // Clear buffer after consumption
      pendingToolResults = "";

      process.stdout.write(chalk.green.bold("\n"));
      process.stdout.write(chalk.green.bold("You:\n"));
      console.log(
        boxen(finalMessageContent, {
          borderColor: "green",
        }),
      );

      messages.push({ role: "user", content: finalMessageContent });
      await saveSession(sessionId, messages);
    } else {
      shouldAutoTriggerAI = false; // Reset for next iteration
    }

    let assistantContent = "";
    process.stdout.write("\n");

    const spinner = ora("Assistant thinking...").start();
    let hasContent = false;

    let retryAttempts = 0;
    const maxRetries = 3;
    let success = false;

    while (retryAttempts <= maxRetries) {
      try {
        const stream = await callAIStream(
          env.OPENROUTER_API_KEY,
          provider.model,
          messages,
          provider.config ?? {},
        );

        spinner.stop();
        success = true;
        process.stdout.write(chalk.cyan.bold("Assistant:\n"));

        for await (const chunk of stream) {
          if (!hasContent) {
            hasContent = true;
          }
          const delta = chunk.choices[0]?.delta?.content || "";
          assistantContent += delta;
          process.stdout.write(delta);
        }
        process.stdout.write("\n\n");
        break; // Success, exit retry loop
      } catch (error: any) {
        retryAttempts++;
        Logger.error(
          `AI call failed (attempt ${retryAttempts}): ${error.message}`,
        );

        if (retryAttempts > maxRetries) {
          spinner.fail("AI request failed after multiple attempts");

          // Save pending state before offering exit choice
          if (pendingToolResults) {
            messages.push({ role: "user", content: pendingToolResults });
            await saveSession(sessionId, messages);
            pendingToolResults = "";
          }

          // Final failure - ask user what to do
          const retryChoice = await select({
            message: "AI service unavailable. What would you like to do?",
            choices: [
              { name: "Retry", value: "retry" },
              { name: "Exit REPL", value: "exit" },
            ],
          });

          if (retryChoice === "retry") {
            retryAttempts = 0; // Reset and try again
            spinner.start("Assistant thinking...");
            continue;
          } else {
            Logger.info("Exiting REPL due to AI service failure");
            return; // Exit the REPL function
          }
        }

        // Brief pause before retry
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * retryAttempts),
        );
      }
    }

    if (!success) continue;

    messages.push({ role: "assistant", content: assistantContent });
    await saveSession(sessionId, messages);

    const toolCalls = parseToolCalls(assistantContent);

    if (toolCalls.length > 0) {
      // 1. Show Plan Summary
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

      // 2. Individual Selection
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
            const result = await executeTool(call);
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

      // 3. Aggregate all results into pending buffer for next user message
      if (toolResults.length > 0) {
        const aggregatedContent = toolResults.join("\n");
        process.stdout.write("\n");

        console.log(
          boxen(aggregatedContent, {
            title: "Tools Result",
            borderColor: "cyan",
          }),
        );

        // Store in pending buffer instead of immediately committing
        pendingToolResults = aggregatedContent;

        if (hasAnyExecution) {
          shouldAutoTriggerAI = true;
          continue;
        }
      }
    }

    shouldAutoTriggerAI = false;
  }
}
