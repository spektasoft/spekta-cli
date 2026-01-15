import ora from "ora";
import { callAI, Message } from "./api";
import { Provider } from "./config";

interface AiExecutionOptions {
  apiKey: string | undefined;
  provider: Provider;
  messages: Message[];
  spinnerTitle: string;
}

/**
 * Handles the lifecycle of an AI request with consistent UI feedback.
 */
export async function executeAiAction(
  options: AiExecutionOptions
): Promise<string> {
  if (!options.apiKey) {
    throw new Error("Configuration Error: Missing OPENROUTER_API_KEY");
  }

  const spinner = ora(options.spinnerTitle).start();

  try {
    const result = await callAI(
      options.apiKey,
      options.provider.model,
      options.messages,
      options.provider.config || {}
    );
    spinner.succeed("Generation complete.");
    return result;
  } catch (error: any) {
    spinner.fail(`Generation failed: ${error.message}`);
    throw error;
  }
}
