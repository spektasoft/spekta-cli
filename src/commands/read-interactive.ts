import { confirm, input, select } from "@inquirer/prompts";
import { execa } from "execa";
import autocomplete from "inquirer-autocomplete-standalone";
import { FileRequest, parseRange } from "../utils/read-utils";
import { runRead } from "./read";

export async function runReadInteractive() {
  const { stdout } = await execa("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  const files = stdout.split("\n").filter((f) => f.trim() !== "");
  const selectedRequests: FileRequest[] = [];

  while (true) {
    if (selectedRequests.length > 0) {
      console.log("\nSelected Files:");
      selectedRequests.forEach((r) =>
        console.log(
          ` - ${r.path}${r.range ? ` [${r.range.start},${r.range.end}]` : ""}`,
        ),
      );
    }

    const action = await select({
      message: "Read File Menu:",
      choices: [
        { name: "Add File", value: "add" },
        { name: "Finalize and Read", value: "done" },
        { name: "Cancel", value: "cancel" },
      ],
    });

    if (action === "cancel") return;
    if (action === "done") break;

    const filePath = await autocomplete({
      message: "Select a file:",
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

    selectedRequests.push({
      path: filePath,
      range: rangeStr ? parseRange(rangeStr) : undefined,
    });

    const addMore = await confirm({
      message: "Add another file?",
      default: false,
    });
    if (!addMore) break;
  }

  if (selectedRequests.length === 0) return;

  const mode = await select({
    message: "Output destination:",
    choices: [
      { name: "Terminal", value: "stdout" },
      { name: "Open in Editor", value: "save" },
    ],
  });

  await runRead(selectedRequests, { save: mode === "save" });
}
