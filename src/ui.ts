import { input, select, confirm } from "@inquirer/prompts";
import { encode } from "gpt-tokenizer";
import autocomplete from "inquirer-autocomplete-standalone";
import { Provider } from "./config";

export const NAV_BACK = "__BACK__";
export const EXIT_KEYWORDS = ["c", "q", "back", "cancel"];

export function isCancel(input: string): boolean {
  return EXIT_KEYWORDS.includes(input.toLowerCase().trim());
}

export interface ProviderSelection {
  isOnlyPrompt: boolean;
  provider?: Provider;
}

/**
 * Generic choice structure for searchable selection
 */
export interface SearchChoice<T> {
  name: string;
  value: T;
  description?: string;
}

/**
 * Reusable searchable select prompt
 */
export async function searchableSelect<T>(
  message: string,
  choices: SearchChoice<T>[],
): Promise<T> {
  return await autocomplete<T>({
    message,
    source: async (input) => {
      if (!input) return choices;
      const term = input.toLowerCase();
      return choices.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          (c.description && c.description.toLowerCase().includes(term)),
      );
    },
  });
}

/**
 * Calculates token count and prompts the user to select a provider.
 */
export async function promptProviderSelection(
  prompt: string,
  providers: Provider[],
  contextMessage: string = "Select provider:",
): Promise<ProviderSelection> {
  const count = getTokenCount(prompt);
  const displayCount =
    prompt.length < 1000000
      ? `${count} (OpenAI-compatible estimate)`
      : `~${Math.round(prompt.length / 4)} (Estimated)`;

  console.log(`\nEstimated Prompt Tokens: ${displayCount}`);

  const choices: SearchChoice<ProviderSelection>[] = [
    {
      name: "Only Prompt (Save to file)",
      value: { isOnlyPrompt: true, provider: undefined },
    },
    ...providers.map((p) => ({
      name: p.name,
      value: { isOnlyPrompt: false, provider: p },
      description: p.model,
    })),
  ];

  return await searchableSelect<ProviderSelection>(contextMessage, choices);
}

export async function confirmCommit(): Promise<boolean> {
  const response = await select({
    message: "Commit the staged changes with this message?",
    choices: [
      { name: "Yes", value: true },
      { name: "No", value: false },
    ],
  });

  return response === true;
}

/**
 * Prompts user for a git commit hash with validation.
 */
export async function promptCommitHash(
  message: string,
  validate?: (value: string) => boolean | string | Promise<boolean | string>,
): Promise<string> {
  return await input({
    message,
    validate: validate || (() => true),
  });
}

/**
 * Prompts user to confirm if they want to proceed with a large token count.
 */
export async function confirmLargePayload(
  tokenCount: number,
): Promise<boolean> {
  const choice = await select({
    message: `The prompt is large (${tokenCount} tokens). Do you want to proceed?`,
    choices: [
      { name: "Yes, proceed with AI generation", value: true },
      { name: "No, cancel or save prompt only", value: false },
    ],
  });
  return choice;
}

/**
 * Calculates token count for a given string.
 */
export function getTokenCount(text: string): number {
  return encode(text).length;
}

export function formatToolPreview(
  type: string,
  path: string,
  content?: string,
): string {
  let preview = `\n--- TOOL CALL: ${type.toUpperCase()} ---\nPath: ${path}\n`;
  if (content) {
    preview += `Content:\n----------------\n${content}\n----------------\n`;
  }
  return preview;
}
