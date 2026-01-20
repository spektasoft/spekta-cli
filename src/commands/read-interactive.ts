import { input, select } from "@inquirer/prompts";
import { execa } from "execa";
import autocomplete from "inquirer-autocomplete-standalone";
import { runRead } from "./read";

export async function runReadInteractive() {
  const { stdout } = await execa("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  const files = stdout.split("\n").filter((f) => f.trim() !== "");

  const filePath = await autocomplete({
    message: "Select a file to read:",
    source: async (input) => {
      const term = input?.toLowerCase() || "";
      return files
        .filter((f) => f.toLowerCase().includes(term))
        .map((f) => ({ value: f, name: f }));
    },
  });

  const rangeStr = await input({
    message: "Enter range (e.g., 1,100) or leave blank for full/overview:",
    default: "",
  });

  const mode = await select({
    message: "Output destination:",
    choices: [
      { name: "Terminal", value: "stdout" },
      { name: "Open in Editor", value: "save" },
    ],
  });

  await runRead(filePath, rangeStr === "" ? undefined : rangeStr, {
    save: mode === "save",
  });
}
