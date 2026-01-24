import { confirm } from "@inquirer/prompts";
import * as readline from "readline";
import { callAIStream, Message } from "../api";
import { getEnv, getPromptContent, getProviders } from "../config";
import { formatToolPreview } from "../ui";
import { promptReplProviderSelection } from "../ui/repl";
import { executeTool, parseToolCalls } from "../utils/agent-utils";
import { Logger } from "../utils/logger";
import { generateSessionId, saveSession } from "../utils/session-utils";
import { getUserMessage } from "../utils/multiline-input";

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

    messages.push({ role: "user", content: userInput });
    await saveSession(sessionId, messages);

    let assistantContent = "";
    process.stdout.write("\nAssistant: ");

    const stream = await callAIStream(
      env.OPENROUTER_API_KEY,
      provider.model,
      messages,
      provider.config ?? {},
    );

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || "";
      assistantContent += delta;
      process.stdout.write(delta);
    }
    process.stdout.write("\n");

    const toolCalls = parseToolCalls(assistantContent);
    let toolDenied = false;

    for (const call of toolCalls) {
      console.log(formatToolPreview(call.type, call.path, call.content));
      const approved = await confirm({
        message: `Execute ${call.type} on ${call.path}?`,
        default: true,
      });

      if (approved) {
        try {
          const result = await executeTool(call);
          messages.push({ role: "assistant", content: call.raw });
          messages.push({ role: "user", content: `Tool Output:\n${result}` });
          Logger.info(`Tool executed successfully.`);
        } catch (err: any) {
          messages.push({
            role: "user",
            content: `Tool Error: ${err.message}`,
          });
          Logger.error(err.message);
        }
      } else {
        toolDenied = true;
        Logger.warn("Tool execution denied by user.");
        break;
      }
    }

    if (!toolDenied && toolCalls.length > 0) {
      // If tools were run, we ideally would loop back to AI automatically,
      // but requirements state breaking on denial. If accepted, we continue
      // the loop which will naturally ask for user input or can be modified
      // to auto-trigger the AI again.
    }

    await saveSession(sessionId, messages);
  }
}
