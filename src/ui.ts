import { encode } from "gpt-tokenizer";
import autocomplete from "inquirer-autocomplete-standalone";
import { Provider } from "./config";

export interface ProviderSelection {
  isOnlyPrompt: boolean;
  provider?: Provider;
}

/**
 * Calculates token count and prompts the user to select a provider.
 */
export async function promptProviderSelection(
  prompt: string,
  providers: Provider[],
  contextMessage: string = "Select provider:"
): Promise<ProviderSelection> {
  const tokenCount =
    prompt.length < 1000000
      ? encode(prompt).length
      : `~${Math.round(prompt.length / 4)} (Estimated)`;

  console.log(`\nEstimated Prompt Tokens: ${tokenCount}`);

  return await autocomplete<ProviderSelection>({
    message: contextMessage,
    source: async (input) => {
      const choices = [
        { name: "Only Prompt (Save to file)", value: { isOnlyPrompt: true } },
        ...providers.map((p) => ({
          name: p.name,
          value: { isOnlyPrompt: false, provider: p },
          description: p.model, // Show model ID as description
        })),
      ];

      if (!input) return choices;

      return choices.filter((c) =>
        c.name.toLowerCase().includes(input.toLowerCase())
      );
    },
  });
}
