import { select } from "@inquirer/prompts";
import { encode } from "gpt-tokenizer";
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
  const tokenCount = encode(prompt).length;

  console.log(`\nEstimated Prompt Tokens: ${tokenCount}`);

  return await select<ProviderSelection>({
    message: contextMessage,
    choices: [
      { name: "Only Prompt (Save to file)", value: { isOnlyPrompt: true } },
      ...providers.map((p) => ({
        name: `${p.name} (${p.model})`,
        value: { isOnlyPrompt: false, provider: p },
      })),
    ],
  });
}
