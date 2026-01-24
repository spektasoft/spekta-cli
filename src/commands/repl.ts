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

  while (true) {
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

    let assistantContent = "";
    process.stdout.write("\n");

    const spinner = ora("Assistant thinking...").start();
    let hasContent = false;

    try {
      const stream = await callAIStream(
        env.OPENROUTER_API_KEY,
        provider.model,
        messages,
        provider.config ?? {},
      );

      spinner.stop();

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
    } catch (error) {
      spinner.fail("AI request failed");
      console.log("Error:", error);
      Logger.error("AI request failed, continuing REPL session");
      continue; // Continue the REPL session instead of exiting
    }

    if (!hasContent) {
      process.stdout.write(""); // Ensure clean output if no content received
    }
    process.stdout.write("\n\n---\n\n");

    const toolCalls = parseToolCalls(assistantContent);
    let toolDenied = false;
    let shouldAutoTriggerAI = false;

    for (const call of toolCalls) {
      console.log(formatToolPreview(call.type, call.path, call.content));

      // Use select instead of confirm
      const choice = await select({
        message: `Execute ${call.type} on ${call.path}?`,
        choices: [
          { name: "Accept", value: "accept" },
          { name: "Reject", value: "reject" },
        ],
      });

      const approved = choice === "accept";

      if (approved) {
        try {
          const result = await executeTool(call);
          messages.push({ role: "assistant", content: call.raw });
          messages.push({ role: "user", content: `Tool Output:\n${result}` });
          Logger.info(`Tool executed successfully.`);

          // Display the actual tool output to user
          console.log(`\nTool Result:\n${result}\n`);

          // Mark that we should auto-trigger AI response
          shouldAutoTriggerAI = true;
        } catch (err: any) {
          messages.push({
            role: "user",
            content: `Tool Error: ${err.message}`,
          });
          Logger.error(err.message);
          console.log(`\nTool Error: ${err.message}\n`);
        }
      } else {
        toolDenied = true;
        Logger.warn("Tool execution denied by user.");
        break;
      }
    }

    // If tools were executed successfully, automatically trigger AI response
    if (shouldAutoTriggerAI && !toolDenied) {
      continue; // Skip asking for user input and go straight to AI
    }

    await saveSession(sessionId, messages);
  }
}
