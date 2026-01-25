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
    } else {
      // Automatic progression: Commit successful results before AI call
      messages.push({ role: "user", content: pendingToolResults });
      await saveSession(sessionId, messages);
      pendingToolResults = "";
      shouldAutoTriggerAI = false;
    }

    let assistantContent = "";
    let success = false;

    while (!success) {
      const spinner = ora("Assistant thinking...").start();
      try {
        const stream = await callAIStream(
          env.OPENROUTER_API_KEY,
          provider.model,
          messages,
          provider.config ?? {},
        );

        spinner.stop();
        process.stdout.write(chalk.cyan.bold("Assistant:\n"));

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content || "";
          assistantContent += delta;
          process.stdout.write(delta);
        }
        process.stdout.write("\n\n");
        success = true;
      } catch (error: any) {
        spinner.fail(`AI call failed: ${error.message}`);

        // Reset assistant buffer on failure to prevent duplicate partial content
        assistantContent = "";

        const retryChoice = await select({
          message: "AI service unavailable. What would you like to do?",
          choices: [
            { name: "Retry", value: "retry" },
            { name: "Exit REPL", value: "exit" },
          ],
        });

        if (retryChoice === "exit") return;
        // If retry, loop continues, spinner restarts
      }
    }

    messages.push({ role: "assistant", content: assistantContent });
    await saveSession(sessionId, messages);

    const toolCalls = parseToolCalls(assistantContent);
    if (toolCalls.length > 0) {
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

      if (toolResults.length > 0) {
        pendingToolResults = toolResults.join("\n");
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
