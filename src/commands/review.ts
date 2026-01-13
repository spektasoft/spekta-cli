import path from "path";
import fs from "fs-extra";
import ora from "ora";
import {
  getEnv,
  getProviders,
  getIgnorePatterns,
  getPromptContent,
  Provider,
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
} from "../fs-manager";
import { callAI } from "../api";
import { input, confirm, select } from "@inquirer/prompts";

type ProviderChoice = {
  isOnlyPrompt: boolean;
  provider?: Provider;
};

async function getHashRange(suggestedStart: string, suggestedEnd: string) {
  const useSuggested = await confirm({
    message: `Use suggested range ${suggestedStart.slice(
      0,
      7
    )}..${suggestedEnd.slice(0, 7)}?`,
    default: true,
  });

  if (useSuggested) {
    return { start: suggestedStart, end: suggestedEnd };
  }

  const start = await input({ message: "Older commit hash:" });
  const end = await input({ message: "Newer commit hash:" });
  return {
    start: await resolveHash(start),
    end: await resolveHash(end),
  };
}

export async function runReview() {
  let providersData;
  try {
    providersData = await getProviders();
  } catch (error: any) {
    console.error(`Configuration Error: ${error.message}`);
    return;
  }

  const { providers } = providersData;
  const env = await getEnv();
  const ignorePatterns = await getIgnorePatterns();

  const isInitial = await confirm({ message: "Is this the initial review?" });
  let folderId: string | undefined;
  let suggestedStart = "";
  let suggestedEnd = await resolveHash("HEAD");

  let dirInfo;

  if (isInitial) {
    const nearestMerge = await getNearestMerge();
    suggestedStart = nearestMerge || (await getInitialCommit());
    dirInfo = await getReviewDir(true);
    folderId = dirInfo.id;
  } else {
    const folders = await listReviewFolders();
    if (folders.length === 0) {
      console.error(
        "No previous reviews found. Please start an initial review."
      );
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
      if (extracted) {
        suggestedStart = await resolveHash(extracted.end);
      }
    }

    if (!suggestedStart) {
      const startInput = await input({ message: "Older commit hash:" });
      suggestedStart = await resolveHash(startInput);
    }
  }

  const { start, end } = await getHashRange(suggestedStart, suggestedEnd);

  const selection = await select<ProviderChoice>({
    message: "Select provider:",
    choices: [
      { name: "Only Prompt", value: { isOnlyPrompt: true } },
      ...providers.map((p) => ({
        name: `${p.name} (${p.model})`,
        value: { isOnlyPrompt: false, provider: p },
      })),
    ],
  });

  const [metadata, diff] = await Promise.all([
    getNextReviewMetadata(dirInfo.dir),
    getGitDiff(start, end, ignorePatterns),
  ]);

  const templateSuffix = selection.isOnlyPrompt ? "-prompt.md" : ".md";
  const templateName = isInitial
    ? `review-initial${templateSuffix}`
    : `review-validation${templateSuffix}`;

  let finalPrompt = (await getPromptContent(templateName)) + "\n\n---\n";

  if (!isInitial && metadata.lastFile) {
    const prevReviewContent = await fs.readFile(
      path.join(dirInfo.dir, metadata.lastFile),
      "utf-8"
    );
    finalPrompt += `PREVIOUS REVIEW:\n\`\`\`\`markdown\n${prevReviewContent}\n\`\`\`\`\n\n---\n`;
  }

  finalPrompt += `GIT DIFF:\n\`\`\`\`markdown\n${diff}\n\`\`\`\`\n`; // Ensure 4 backticks matches opening

  const fileName = `r-${String(metadata.nextNum).padStart(
    3,
    "0"
  )}-${start.slice(0, 7)}..${end.slice(0, 7)}.md`;
  const filePath = path.join(dirInfo.dir, fileName);

  if (selection.isOnlyPrompt) {
    await fs.writeFile(filePath, finalPrompt);
    console.log(`Generated: ${filePath}`);
  } else {
    if (!env.OPENROUTER_API_KEY) {
      console.error("Configuration Error: Missing OPENROUTER_API_KEY");
      return;
    }

    const provider = selection.provider!;
    const spinner = ora(
      `AI is reviewing your code using ${provider.model}...`
    ).start();

    try {
      const result = await callAI(
        env.OPENROUTER_API_KEY,
        provider.model,
        finalPrompt,
        provider.config || {} // Pass the config
      );

      await fs.writeFile(filePath, result || "");
      spinner.succeed(`Review saved: ${filePath}`);
    } catch (error: any) {
      spinner.fail(`AI Review failed: ${error.message}`);
      throw error; // Re-throw for CLI exit code and testing
    }
  }
}
