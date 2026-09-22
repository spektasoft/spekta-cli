import chalk from "chalk";
import ora, { Ora } from "ora";
import { ChatCompletionChunkWithReasoning } from "../../api/api";

export interface StreamConsumerOptions {
  spinner?: Ora;
  stdout?: { write: (chunk: string) => boolean | void };
}

export interface StreamConsumerResult {
  content: string;
  reasoning: string;
  interrupted: boolean;
}

export async function consumeAssistantStream(
  stream: AsyncIterable<unknown>,
  options: StreamConsumerOptions = {},
): Promise<StreamConsumerResult> {
  const spinner = options.spinner ?? ora("Calling assistant...\n").start();
  const stdout = options.stdout ?? process.stdout;

  let assistantContent = "";
  let assistantReasoning = "";
  let isThinking = false;
  let firstTokenReceived = false;

  try {
    for await (const chunk of stream) {
      if (!firstTokenReceived) {
        spinner.stop();
        stdout.write(chalk.cyan.bold("Assistant:\n"));
        stdout.write(chalk.dim("(Press Ctrl+C to interrupt)\n"));
        firstTokenReceived = true;
      }

      const delta = (chunk as ChatCompletionChunkWithReasoning).choices?.[0]
        ?.delta;
      const reasoning = delta?.reasoning_details?.[0]?.text || "";
      const content = delta?.content || "";

      if (reasoning) {
        if (!isThinking) {
          stdout.write("\n" + chalk.cyan.italic.dim("Thought:\n"));
          isThinking = true;
        }
        assistantReasoning += reasoning;
        stdout.write(chalk.italic.dim(reasoning));
      }

      if (content) {
        if (isThinking) {
          stdout.write(chalk.reset("\n\n"));
          isThinking = false;
        }
        assistantContent += content;
        stdout.write(content);
      }
    }

    stdout.write("\n\n");
    return {
      content: assistantContent,
      reasoning: assistantReasoning,
      interrupted: false,
    };
  } catch (streamError: unknown) {
    if (streamError instanceof Error && streamError.name === "AbortError") {
      if (!firstTokenReceived) spinner.stop();
      stdout.write(chalk.yellow.bold("\n\n[Interrupted by user]\n"));
      return {
        content: assistantContent,
        reasoning: assistantReasoning,
        interrupted: true,
      };
    }
    throw streamError;
  } finally {
    spinner.stop();
  }
}
