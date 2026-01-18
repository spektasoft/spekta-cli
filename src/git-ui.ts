import { input, select } from "@inquirer/prompts";
import { resolveHash, isValidHash } from "./git";

async function validatedHashInput(message: string): Promise<string> {
  while (true) {
    const rawInput = await input({ message });
    if (isValidHash(rawInput)) {
      try {
        return await resolveHash(rawInput);
      } catch (error) {
        console.error("The hash provided does not exist in the repository.");
      }
    } else {
      console.error(
        "Invalid format. Please provide a 7-40 character hex hash.",
      );
    }
  }
}

export async function promptHashRange(
  suggestedStart: string,
  suggestedEnd: string,
): Promise<{ start: string; end: string }> {
  const useSuggested = await select({
    message: `Use suggested range ${suggestedStart.slice(0, 7)}..${suggestedEnd.slice(0, 7)}?`,
    choices: [
      { name: "Yes", value: true },
      { name: "No", value: false },
    ],
  });

  if (useSuggested) {
    return { start: suggestedStart, end: suggestedEnd };
  }

  const start = await validatedHashInput("Older commit hash:");
  const end = await validatedHashInput("Newer commit hash:");
  return { start, end };
}