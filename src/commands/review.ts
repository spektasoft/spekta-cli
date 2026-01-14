import path from "path";
import fs from "fs-extra";
import {
  getEnv,
  getProviders,
  getIgnorePatterns,
  getPromptContent,
} from "../config";
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
  ReviewDirInfo,
} from "../fs-manager";
import { input, confirm, select } from "@inquirer/prompts";
import { promptProviderSelection } from "../ui";
import { executeAiAction } from "../orchestrator";

async function getHashRange(suggestedStart: string, suggestedEnd: string) {
  const useSuggested = await confirm({
    message: `Use suggested range ${suggestedStart.slice(
      0,
      7
    )}..${suggestedEnd.slice(0, 7)}?`,
    default: true,
  });

  if (useSuggested) return { start: suggestedStart, end: suggestedEnd };

  const start = await input({ message: "Older commit hash:" });
  const end = await input({ message: "Newer commit hash:" });
  return { start: await resolveHash(start), end: await resolveHash(end) };
}

export async function runReview() {
  const [providersData, env, ignorePatterns] = await Promise.all([
    getProviders(),
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
  let dirInfo: ReviewDirInfo;

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
    dirInfo = await getReviewDir(false, folderId);
    const metadata = await getNextReviewMetadata(dirInfo.dir);
    if (metadata.lastFile) {
      const extracted = getHashesFromReviewFile(metadata.lastFile);
      if (extracted) suggestedStart = await resolveHash(extracted.end);
    }
    if (!suggestedStart) {
      suggestedStart = await resolveHash(
        await input({ message: "Older commit hash:" })
      );
    }
  }

  const { start, end } = await getHashRange(suggestedStart, suggestedEnd);
  const [metadata, diff] = await Promise.all([
    getNextReviewMetadata(dirInfo.dir),
    getGitDiff(start, end, ignorePatterns),
  ]);

  let finalPrompt =
    (await getPromptContent(
      isInitial ? "review-initial.md" : "review-validation.md"
    )) + "\n\n---\n";

  if (!isInitial && metadata.lastFile) {
    const prevReviewContent = await fs.readFile(
      path.join(dirInfo.dir, metadata.lastFile),
      "utf-8"
    );
    finalPrompt += `PREVIOUS REVIEW:\n\`\`\`\`markdown\n${prevReviewContent}\n\`\`\`\`\n\n---\n`;
  }
  finalPrompt += `GIT DIFF:\n\`\`\`\`markdown\n${diff}\n\`\`\`\`\n`;

  const selection = await promptProviderSelection(
    finalPrompt,
    providersData.providers
  );
  const fileName = `r-${String(metadata.nextNum).padStart(
    3,
    "0"
  )}-${start.slice(0, 7)}..${end.slice(0, 7)}.md`;
  const filePath = path.join(dirInfo.dir, fileName);

  if (selection.isOnlyPrompt) {
    await fs.writeFile(filePath, finalPrompt);
    console.log(`Generated: ${filePath}`);
  } else {
    const result = await executeAiAction({
      apiKey: env.OPENROUTER_API_KEY,
      provider: selection.provider!,
      prompt: finalPrompt,
      spinnerTitle: `AI is reviewing your code using ${
        selection.provider!.model
      }...`,
    });
    await fs.writeFile(filePath, result);
    console.log(`Review saved: ${filePath}`);
  }
}
