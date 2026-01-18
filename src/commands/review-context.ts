import path from "path";
import fs from "fs-extra";
import { input, confirm, select, checkbox } from "@inquirer/prompts";
import { searchableSelect } from "../ui";
import { getPlansDir } from "../fs-manager";

export interface SelectedItem {
  type: "plan" | "file";
  identifier: string; // filename for plan, path for file
  content: string;
  lineCount: number;
}

export type MenuAction = "plan" | "file" | "remove" | "finalize";

export async function collectSupplementalContext(): Promise<string> {
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
