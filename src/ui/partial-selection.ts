import { checkbox, select } from "@inquirer/prompts";

import { listPartials, PartialSelection } from "../core/config/partials";

type PartialSelectionChoice = "default" | "include" | "exclude";

export const selectPromptPartials = async (): Promise<PartialSelection> => {
  const partials = await listPartials();

  if (partials.length === 0) {
    return { include: [], exclude: [] };
  }

  const mode = (await select<PartialSelectionChoice>({
    message: "How would you like to handle partials?",
    choices: [
      { name: "Generate Now", value: "default" },
      { name: "Include", value: "include" },
      { name: "Exclude", value: "exclude" },
    ],
  })) as PartialSelectionChoice;

  if (mode === "default") {
    return { include: [], exclude: [] };
  }

  const selected = await checkbox<string>({
    message:
      mode === "include"
        ? "Select partials to include:"
        : "Select partials to exclude:",
    choices: partials.map((partial) => ({
      name: partial.name,
      value: partial.name,
    })),
  });

  return mode === "include"
    ? { include: selected, exclude: [] }
    : { include: [], exclude: selected };
};
