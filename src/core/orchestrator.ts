import ora from "ora";
import { callAIWithProvider, Message } from "../api/api";
import { Provider } from "./config";

interface AiExecutionOptions {
  provider: Provider;
  messages: Message[];
  spinnerTitle: string;
  quiet?: boolean;
}

/**
 * Handles the lifecycle of an AI request with consistent UI feedback.
 */
export async function executeAiAction(
  options: AiExecutionOptions,
): Promise<string> {
  const spinner = options.quiet ? undefined : ora(options.spinnerTitle).start();
  try {
    const result = await callAIWithProvider(
      options.provider,
      options.messages,
      options.provider.config || {},
    );
    spinner?.succeed("Generation complete.");
    return result;
  } catch (error: any) {
    spinner?.fail(`Generation failed: ${error.message}`);
    throw error;
  }
}
