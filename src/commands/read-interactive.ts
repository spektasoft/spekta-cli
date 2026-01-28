import { checkbox, input, select } from "@inquirer/prompts";
import { execa } from "execa";
import ignore from "ignore";
import autocomplete from "inquirer-autocomplete-standalone";
import path from "path";
import { getEnv, getIgnorePatterns } from "../config";
import { openEditor } from "../editor-utils";
import { NAV_BACK, isCancel } from "../ui";
import { FileRequest, LineRange, validateFileRange } from "../utils/read-utils";
import { RESTRICTED_FILES } from "../utils/security";
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

  console.log("\nInteractive File Reader");
  console.log("Files will open in your editor if SPEKTA_EDITOR is configured.");
  console.log("Token limits are validated before adding files.\n");

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
      const filePath = await autocomplete({
        message: "Select a file:",
        source: async (input) => {
          const term = input?.toLowerCase() || "";
          const filtered = files
            .filter((f) => f.toLowerCase().includes(term))
            .map((f) => ({ value: f, name: f }));

          return [{ name: "[Back]", value: NAV_BACK }, ...filtered];
        },
      });
      if (filePath === NAV_BACK) continue;

      const env = await getEnv();
      const editor = env.SPEKTA_EDITOR;
      const tokenLimit = parseInt(env.SPEKTA_READ_TOKEN_LIMIT || "1000", 10);

      const startInput = await input({
        message: "Start line (o: open, f: full, c: cancel):",
        default: "1",
      });
      if (isCancel(startInput)) continue;

      if (startInput.toLowerCase() === "o") {
        if (editor) {
          console.log(`Opening ${filePath} in editor...`);
          openEditor(editor, filePath).catch((err) => {
            console.warn(`Could not open editor: ${err.message}`);
          });
        } else {
          console.warn("SPEKTA_EDITOR not configured.");
        }
        continue;
      }

      let range: LineRange | undefined;
      let tokensMessage = "";

      if (startInput.toLowerCase() === "f") {
        const validation = await validateFileRange(
          filePath,
          { start: 1, end: "$" },
          tokenLimit,
        );
        tokensMessage = ` (${validation.tokens} tokens)`;
        if (!validation.valid) {
          console.warn(`Warning: ${validation.message}`);
        } else {
          console.log(`Full file will be added${tokensMessage}`);
        }
        // Full file: no range
      } else {
        const endInput = await input({
          message: "End line (c: cancel):",
          default: "$",
        });
        if (isCancel(endInput)) continue;

        const start = parseInt(startInput, 10);
        const end = endInput === "$" ? "$" : parseInt(endInput, 10);
        range = {
          start: isNaN(start) ? 1 : start,
          end: isNaN(end as number) && end !== "$" ? "$" : end,
        };
        const validation = await validateFileRange(filePath, range, tokenLimit);
        tokensMessage = ` (${validation.tokens} tokens)`;
        if (!validation.valid) {
          console.warn(`Warning: ${validation.message}`);
        } else {
          console.log(`Range will be added${tokensMessage}`);
        }
      }

      selectedRequests.push({ path: filePath, range });
      // Always add
      console.log(
        `Added ${filePath}${range ? ` [${range.start},${range.end}]` : ""}${tokensMessage}`,
      );
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
  await runRead(selectedRequests, { save: true, interactive: true });
}
