import { select } from "@inquirer/prompts";
import ora from "ora";
import * as readline from "readline";
import { callAIStream, Message } from "../api";
import { getEnv, getPromptContent, getProviders } from "../config";
import { formatToolPreview } from "../ui";
import { promptReplProviderSelection } from "../ui/repl";
import { executeTool, parseToolCalls } from "../utils/agent-utils";
import { Logger } from "../utils/logger";
import { getUserMessage } from "../utils/multiline-input";
import { generateSessionId, saveSession } from "../utils/session-utils";

/**
 * Get multiline input from user with ability to interrupt and see responses
 */
async function getMultilineInput(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const lines: string[] = [];

    const askForLine = () => {
      const promptText =
        lines.length === 0
          ? `${prompt}\n(Multiline mode - type 'END' on its own line to submit, 'CANCEL' to abort)\n> `
          : `${lines.length + 1}> `;

      rl.question(promptText, (input) => {
        if (input.trim().toUpperCase() === "CANCEL") {
          rl.close();
          resolve("");
          return;
        }

        if (input.trim().toUpperCase() === "END") {
          rl.close();
          resolve(lines.join("\n"));
          return;
        }

        lines.push(input);
        askForLine();
      });
    };

    askForLine();
  });
}

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

  while (true) {
    if (!shouldAutoTriggerAI) {
      const userInput = await getUserMessage("You:");

      if (userInput === null) {
        // cancelled → just loop again
        continue;
      }

      if (userInput.toLowerCase() === "exit") {
        break;
      }

      if (userInput.trim() === "") {
        continue; // safety net – should not happen
      }

      process.stdout.write("You:\n");
      process.stdout.write(userInput);
      process.stdout.write("\n---\n");

      messages.push({ role: "user", content: userInput });
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
        process.stdout.write("Assistant:\n");

        for await (const chunk of stream) {
          if (!hasContent) {
            hasContent = true;
            process.stdout.write(""); // Clear any remaining spinner artifacts
          }
          const delta = chunk.choices[0]?.delta?.content || "";
          assistantContent += delta;
          process.stdout.write(delta);
        }
        break; // Success, exit retry loop
      } catch (error: any) {
        retryAttempts++;
        Logger.error(
          `AI call failed (attempt ${retryAttempts}): ${error.message}`,
        );

        if (retryAttempts > maxRetries) {
          spinner.fail("AI request failed after multiple attempts");
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

    if (!hasContent) {
      process.stdout.write(""); // Ensure clean output if no content received
    }
    process.stdout.write("\n\n---\n\n");

    messages.push({ role: "assistant", content: assistantContent });
    await saveSession(sessionId, messages);

    const toolCalls = parseToolCalls(assistantContent);
    let toolDenied = false;
    let toolExecuted = false;

    for (const call of toolCalls) {
      console.log(formatToolPreview(call.type, call.path, call.content));

      const choice = await select({
        message: `Execute ${call.type} on ${call.path}?`,
        choices: [
          { name: "Accept", value: "accept" },
          { name: "Reject", value: "reject" },
        ],
      });

      if (choice === "accept") {
        try {
          const result = await executeTool(call);
          messages.push({ role: "user", content: `Tool Output:\n${result}` });
          process.stdout.write(`\nTool Output:\n${result}\n`);
          toolExecuted = true;
        } catch (err: any) {
          messages.push({
            role: "user",
            content: `Tool Error: ${err.message}`,
          });
          process.stdout.write(`\nTool Error: ${err.message}\n`);
          toolExecuted = true;
        }
      } else {
        toolDenied = true;
        Logger.warn("Tool execution denied by user.");
        break;
      }
    }

    await saveSession(sessionId, messages);

    // Auto-trigger AI response only if tools were executed and NONE were denied
    if (toolExecuted && !toolDenied) {
      shouldAutoTriggerAI = true;
      continue;
    } else {
      shouldAutoTriggerAI = false;
    }
  }
}
