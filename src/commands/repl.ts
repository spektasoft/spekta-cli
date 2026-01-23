import { getEnv, getProviders, getPromptContent } from "../config";
import { promptReplProviderSelection } from "../ui/repl";
import { callAIStream, Message } from "../api";
import { Logger } from "../utils/logger";
import { generateSessionId, saveSession } from "../utils/session-utils";
import { input } from "@inquirer/prompts";

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
    const userInput = await input({ message: "You:" });
    if (userInput.toLowerCase() === "exit") break;

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
    messages.push({ role: "assistant", content: assistantContent });
    await saveSession(sessionId, messages);
  }
}
