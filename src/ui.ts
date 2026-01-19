import { input, select } from "@inquirer/prompts";
import { encode } from "gpt-tokenizer";
import autocomplete from "inquirer-autocomplete-standalone";
import { Provider } from "./config";

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
  const tokenCount =
    prompt.length < 1000000
      ? encode(prompt).length
      : `~${Math.round(prompt.length / 4)} (Estimated)`;

  console.log(`\nEstimated Prompt Tokens: ${tokenCount}`);

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
