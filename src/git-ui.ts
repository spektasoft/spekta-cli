import { input, select } from "@inquirer/prompts";
import { resolveHash } from "./git";

export interface HashRange {
  start: string;
  end: string;
}

/**
 * Prompts the user to confirm or provide a commit range.
 */
export async function promptHashRange(
  suggestedStart: string,
  suggestedEnd: string,
): Promise<HashRange> {
  const useSuggested = await select({
    message: `Use suggested range ${suggestedStart.slice(
      0,
      7,
    )}..${suggestedEnd.slice(0, 7)}?`,
    choices: [
      { name: "Yes", value: true },
      { name: "No", value: false },
    ],
  });

  if (useSuggested) {
    return { start: suggestedStart, end: suggestedEnd };
  }

  const startInput = await input({ message: "Older commit hash (or ref):" });
  const endInput = await input({ message: "Newer commit hash (or ref):" });

  return {
    start: await resolveHash(startInput),
    end: await resolveHash(endInput),
  };
}
