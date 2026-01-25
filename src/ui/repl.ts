import { Provider } from "../config";
import { searchableSelect, SearchChoice } from "../ui";

export async function promptReplProviderSelection(
  prompt: string,
  providers: Provider[],
): Promise<Provider> {
  if (providers.length === 0) {
    throw new Error(
      "No AI providers available. Configure providers before starting the REPL.",
    );
  }

  const choices: SearchChoice<Provider>[] = providers.map((p) => ({
    name: p.name,
    value: p,
    description: p.model,
  }));

  return await searchableSelect<Provider>("Select provider:", choices);
}
