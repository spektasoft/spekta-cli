import { checkbox, input, select } from "@inquirer/prompts";
import { execa } from "execa";
import ignore from "ignore";
import autocomplete from "inquirer-autocomplete-standalone";
import path from "path";
import { RESTRICTED_FILES } from "../utils/security";
import { getIgnorePatterns } from "../config";
import { FileRequest, parseRange } from "../utils/read-utils";
import { runRead } from "./read";

export async function runReadInteractive() {
  const { stdout } = await execa("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  const allFiles = stdout.split("\n").filter((f) => f.trim() !== "");

  const spektaIgnores = await getIgnorePatterns();
  const ig = ignore().add(spektaIgnores);

  // Filter files by gitignore, spektaignore, and restricted system files
  const files = allFiles.filter((f) => {
    const isIgnored = ig.ignores(f);
    const isRestricted = RESTRICTED_FILES.includes(path.basename(f));
    return !isIgnored && !isRestricted;
  });

  const selectedRequests: FileRequest[] = [];

  while (true) {
    if (selectedRequests.length > 0) {
      console.log("\nSelected Files:");
      selectedRequests.forEach((r, idx) =>
        console.log(
          ` [${idx}] ${r.path}${r.range ? ` [${r.range.start},${r.range.end}]` : ""}`,
        ),
      );
    }

    const action = await select({
      message: "Read File Menu:",
      choices: [
        { name: "Add File", value: "add" },
        {
          name: "Remove File",
          value: "remove",
          disabled:
            selectedRequests.length === 0 ? "(No files to remove)" : false,
        },
        { name: "Finalize and Read", value: "done" },
        { name: "Cancel", value: "cancel" },
      ],
    });

    if (action === "cancel") return;
    if (action === "done") break;

    if (action === "add") {
      const BACK_SENTINEL = "__BACK__";
      const filePath = await autocomplete({
        message: "Select a file:",
        source: async (input) => {
          const term = input?.toLowerCase() || "";
          const filtered = files
            .filter((f) => f.toLowerCase().includes(term))
            .map((f) => ({ value: f, name: f }));

          return [{ name: "[Back]", value: BACK_SENTINEL }, ...filtered];
        },
      });

      if (filePath === BACK_SENTINEL) continue;

      const rangeStr = await input({
        message: "Enter range (e.g., 1,100) or leave blank for full/overview:",
        default: "",
      });

      selectedRequests.push({
        path: filePath,
        range: rangeStr ? parseRange(rangeStr) : undefined,
      });
    }

    if (action === "remove") {
      const removalChoices = selectedRequests.map((req, index) => ({
        name: `${req.path}${req.range ? ` [${req.range.start},${req.range.end}]` : ""}`,
        value: index,
      }));

      const toRemoveIndices = await checkbox({
        message: "Select files to remove:",
        choices: removalChoices,
      });

      if (toRemoveIndices.length > 0) {
        // Sort indices in descending order to avoid splice offset issues
        toRemoveIndices
          .sort((a, b) => b - a)
          .forEach((index) => {
            selectedRequests.splice(index, 1);
          });
        console.log(`Removed ${toRemoveIndices.length} items.`);
      }
      continue;
    }
  }

  if (selectedRequests.length === 0) {
    console.log("No files selected.");
    return;
  }

  // Logic to execute immediately after loop break
  await runRead(selectedRequests, { save: true });
}
