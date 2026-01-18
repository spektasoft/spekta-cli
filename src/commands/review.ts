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
  getNextReviewMetadata,
  listReviewFolders,
  getHashesFromReviewFile,
} from "../fs-manager";
import { input, confirm, select } from "@inquirer/prompts";
import { execa } from "execa";

async function getHashRange(suggestedStart: string, suggestedEnd: string) {
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

  if (useSuggested) return { start: suggestedStart, end: suggestedEnd };

  const start = await input({ message: "Older commit hash:" });
  const end = await input({ message: "Newer commit hash:" });
  return { start: await resolveHash(start), end: await resolveHash(end) };
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
      folderId = await select({
        message: "Select review folder:",
        choices: folders.map((f) => ({ name: f, value: f })),
      });
      dirInfo = await getReviewDir(false, folderId); // Use selected folder
      const metadata = await getNextReviewMetadata(dirInfo.dir);
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

    const { start, end } = await getHashRange(suggestedStart, suggestedEnd);
    const [metadata, diff] = await Promise.all([
      getNextReviewMetadata(dirInfo.dir),
      getGitDiff(start, end, ignorePatterns),
    ]);

    const templateName = isInitial
      ? "review-initial.md"
      : "review-validation.md";

    let finalPrompt = (await getPromptContent(templateName)) + "\n\n---\n";

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
