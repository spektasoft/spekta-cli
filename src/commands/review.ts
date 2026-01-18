import path from "path";
import fs from "fs-extra";
import { getEnv, getIgnorePatterns, getPromptContent } from "../config";
import {
  getGitDiff,
  resolveHash,
  getNearestMerge,
  getInitialCommit,
} from "../git";
import {
  getReviewDir,
  listReviewFolders,
  getHashesFromReviewFile,
  getSafeMetadata,
  getPlansDir,
} from "../fs-manager";
import { input, confirm, select, checkbox } from "@inquirer/prompts";
import { searchableSelect } from "../ui";
import { execa } from "execa";
import { promptHashRange } from "../git-ui";

interface SelectedItem {
  type: "plan" | "file";
  identifier: string; // filename for plan, path for file
  content: string;
  lineCount: number;
}

type MenuAction = "plan" | "file" | "remove" | "finalize";

async function collectSupplementalContext(): Promise<string> {
  const selectedItems: SelectedItem[] = [];
  let totalLineCount = 0;
  const LINE_THRESHOLD = 1500;

  while (true) {
    // Display current selections
    if (selectedItems.length > 0) {
      console.log("\n=== Current Selections ===");
      selectedItems.forEach((item) => {
        const label = item.type === "plan" ? "[Plan]" : "[File]";
        console.log(`  ${label} ${item.identifier} (${item.lineCount} lines)`);
      });
      console.log(`  Total lines: ${totalLineCount}`);
      console.log("==========================\n");
    }

    // Build dynamic menu choices
    const choices: Array<{ name: string; value: MenuAction }> = [
      { name: "Add Implementation Plan", value: "plan" },
      { name: "Add File by Path", value: "file" },
    ];

    // Only show remove option if there are selections
    if (selectedItems.length > 0) {
      choices.push({ name: "Remove Selected Items", value: "remove" });
    }

    // Dynamic finalize label
    choices.push({
      name: selectedItems.length === 0 ? "None" : "Finalize Selection",
      value: "finalize",
    });

    const action = await select<MenuAction>({
      message: "Add additional context for this initial review?",
      choices,
    });

    if (action === "finalize") {
      break;
    }

    if (action === "plan") {
      const plansDir = await getPlansDir();
      const files = await fs.readdir(plansDir);
      const mdFiles = files.filter((f) => f.endsWith(".md"));

      if (mdFiles.length === 0) {
        console.warn(
          "No implementation plans found in spekta/docs/implementations.",
        );
        continue;
      }

      // Filter out already-selected plans
      const selectedPlanNames = selectedItems
        .filter((item) => item.type === "plan")
        .map((item) => item.identifier);
      const availablePlans = mdFiles.filter(
        (f) => !selectedPlanNames.includes(f),
      );

      if (availablePlans.length === 0) {
        console.log("All available plans have already been selected.");
        continue;
      }

      const selectedPlan = await searchableSelect<string>(
        "Select an implementation plan:",
        availablePlans.map((f) => ({ name: f, value: f })),
      );

      const planPath = path.join(plansDir, selectedPlan);
      const content = await fs.readFile(planPath, "utf-8");
      const lineCount = content.split("\n").length;

      // Individual plan size warning
      if (lineCount > 300) {
        const proceed = await confirm({
          message: `Warning: ${selectedPlan} is ${lineCount} lines long. Large files may degrade LLM performance. Include anyway?`,
          default: false,
        });
        if (!proceed) continue;
      }

      // Check cumulative size threshold
      const newTotal = totalLineCount + lineCount;
      if (newTotal > LINE_THRESHOLD) {
        const proceed = await confirm({
          message: `Warning: Total context will be ${newTotal} lines (threshold: ${LINE_THRESHOLD}). This may degrade LLM performance. Continue?`,
          default: false,
        });
        if (!proceed) continue;
      }

      selectedItems.push({
        type: "plan",
        identifier: selectedPlan,
        content,
        lineCount,
      });
      totalLineCount += lineCount;
      console.log(`Added plan: ${selectedPlan} (${lineCount} lines)`);
    } else if (action === "file") {
      const filePath = await input({
        message: "Enter file path to include:",
      });

      if (!filePath.trim()) {
        console.log("No path entered. Returning to menu.");
        continue;
      }

      const trimmedPath = filePath.trim();
      const absolutePath = path.resolve(process.cwd(), trimmedPath);

      // Check for duplicate
      if (
        selectedItems.some(
          (item) => item.type === "file" && item.identifier === trimmedPath,
        )
      ) {
        console.warn(`File already selected: ${trimmedPath}`);
        continue;
      }

      if (!(await fs.pathExists(absolutePath))) {
        console.error(`File not found: ${trimmedPath}`);
        continue;
      }

      const stats = await fs.stat(absolutePath);
      if (stats.isDirectory()) {
        console.error(
          "Directories are not supported. Please provide a file path.",
        );
        continue;
      }

      const content = await fs.readFile(absolutePath, "utf-8");
      const lineCount = content.split("\n").length;

      // Individual file size warning
      if (lineCount > 300) {
        const proceed = await confirm({
          message: `Warning: ${trimmedPath} is ${lineCount} lines long. Large files may degrade LLM performance. Include anyway?`,
          default: false,
        });
        if (!proceed) continue;
      }

      // Check cumulative size threshold
      const newTotal = totalLineCount + lineCount;
      if (newTotal > LINE_THRESHOLD) {
        const proceed = await confirm({
          message: `Warning: Total context will be ${newTotal} lines (threshold: ${LINE_THRESHOLD}). This may degrade LLM performance. Continue?`,
          default: false,
        });
        if (!proceed) continue;
      }

      selectedItems.push({
        type: "file",
        identifier: trimmedPath,
        content,
        lineCount,
      });
      totalLineCount += lineCount;
      console.log(`Added file: ${trimmedPath} (${lineCount} lines)`);
    } else if (action === "remove") {
      // Build checkbox choices
      const removalChoices = selectedItems.map((item, index) => ({
        name: `[${item.type === "plan" ? "Plan" : "File"}] ${item.identifier} (${item.lineCount} lines)`,
        value: index,
        checked: false,
      }));

      const toRemoveIndices = await checkbox({
        message: "Select items to remove (Space to toggle, Enter to confirm):",
        choices: removalChoices,
      });

      if (toRemoveIndices.length === 0) {
        console.log("No items selected for removal.");
        continue;
      }

      // Process removals in reverse order to maintain indices
      toRemoveIndices
        .sort((a, b) => b - a)
        .forEach((index) => {
          const removed = selectedItems.splice(index, 1)[0];
          totalLineCount -= removed.lineCount;
          const typeLabel = removed.type === "plan" ? "plan" : "file";
          console.log(`Removed ${typeLabel}: ${removed.identifier}`);
        });
    }
  }

  // Build final context string
  if (selectedItems.length === 0) {
    return "";
  }

  let contextContent = "\n\n### SUPPLEMENTAL CONTEXT\n\n";

  // Add all selected items
  for (const item of selectedItems) {
    const header =
      item.type === "plan"
        ? `#### REFERENCE IMPLEMENTATION PLAN: ${item.identifier}`
        : `#### REFERENCE FILE: ${item.identifier}`;
    contextContent += `${header}\n\n\`\`\`\`markdown\n${item.content}\n\`\`\`\`\n\n`;
  }

  return contextContent;
}

export async function runReview() {
  try {
    const [env, ignorePatterns] = await Promise.all([
      getEnv(),
      getIgnorePatterns(),
    ]);

    const isInitial = await select<boolean>({
      message: "Review Type:",
      choices: [
        { name: "Start a new initial review", value: true },
        { name: "Continue from a previous review", value: false },
      ],
    });

    // NEW: Gather supplemental context only for initial reviews
    let supplementalContext = "";
    if (isInitial) {
      supplementalContext = await collectSupplementalContext();
    }

    let folderId: string | undefined;
    let suggestedStart = "";
    let suggestedEnd = await resolveHash("HEAD");

    let dirInfo: { dir: string; id: string };

    if (isInitial) {
      const nearestMerge = await getNearestMerge();
      suggestedStart = nearestMerge || (await getInitialCommit());
      dirInfo = await getReviewDir(true);
    } else {
      const folders = await listReviewFolders();
      if (folders.length === 0) {
        console.error("No previous reviews found.");
        return;
      }

      folderId = await searchableSelect<string>(
        "Select review folder:",
        folders.map((f) => ({ name: f, value: f })),
      );

      dirInfo = await getReviewDir(false, folderId);
    }

    // Fetch metadata ONCE after directory has been resolved
    const metadata = await getSafeMetadata(dirInfo.dir);

    if (!isInitial) {
      if (metadata.lastFile) {
        const extracted = getHashesFromReviewFile(metadata.lastFile);
        if (extracted) suggestedStart = await resolveHash(extracted.end);
      }
      if (!suggestedStart) {
        suggestedStart = await resolveHash(
          await input({ message: "Older commit hash:" }),
        );
      }
    }

    const { start, end } = await promptHashRange(suggestedStart, suggestedEnd);
    const diff = await getGitDiff(start, end, ignorePatterns);

    const templateName = isInitial
      ? "review-initial.md"
      : "review-validation.md";

    let finalPrompt = (await getPromptContent(templateName)) + "\n\n---\n";

    // Inject supplemental context if present
    if (supplementalContext) {
      finalPrompt += supplementalContext + "\n---\n";
    }

    if (!isInitial && metadata.lastFile) {
      const prevReviewContent = await fs.readFile(
        path.join(dirInfo.dir, metadata.lastFile),
        "utf-8",
      );
      finalPrompt += `PREVIOUS REVIEW:\n\`\`\`\`markdown\n${prevReviewContent}\n\`\`\`\`\n\n---\n`;
    }
    finalPrompt += `GIT DIFF:\n\`\`\`\`markdown\n${diff}\n\`\`\`\`\n`;

    const fileName = `r-${String(metadata.nextNum).padStart(
      3,
      "0",
    )}-${start.slice(0, 7)}..${end.slice(0, 7)}.md`;
    const filePath = path.join(dirInfo.dir, fileName);

    await fs.writeFile(filePath, finalPrompt);
    console.log(`Generated: ${filePath}`);

    const editor = env.SPEKTA_EDITOR;
    if (editor) {
      try {
        // Ensure stdio: "inherit" is kept for terminal-based editors like vim/nano
        await execa(editor, [filePath], { stdio: "inherit" });
      } catch (editorError: any) {
        console.warn(`\nWarning: Failed to open editor "${editor}".`);
        console.warn(`Detail: ${editorError.message}`);
        console.log(`You can manually open the review at: ${filePath}`);
        process.exitCode = 1;
      }
    } else {
      console.log("\n--- Action Required ---");
      console.log(`Review prompt generated at: ${filePath}`);
      console.log(
        "Tip: Set SPEKTA_EDITOR in your .env to open this automatically.",
      );
    }
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
