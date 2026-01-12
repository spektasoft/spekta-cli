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
import { getGitDiff } from "../git";
import { getReviewDir, getNextReviewMetadata } from "../fs-manager";
import { callAI } from "../api";
import { input, confirm, select } from "@inquirer/prompts";

// Helper type for selection
type ProviderChoice = {
  isOnlyPrompt: boolean;
  provider?: Provider;
};

export async function runReview() {
  // Initialization check
  let providersData;
  try {
    providersData = await getProviders();
  } catch (error: any) {
    console.error(`Configuration Error: ${error.message}`);
    return;
  }

  const { providers } = providersData;
  const env = getEnv();
  const ignorePatterns = getIgnorePatterns();

  const start = await input({ message: "Older commit hash:" });
  const end = await input({ message: "Newer commit hash:" });

  const isInitial = await confirm({ message: "Is this the initial review?" });
  let folderId: string | undefined;
  if (!isInitial) {
    folderId = await input({
      message: "Enter review folder ID (YYYYMMDDHHHH):",
    });
  }

  const selection = await select<ProviderChoice>({
    message: "Select provider:",
    choices: [
      {
        name: "Only Prompt",
        value: { isOnlyPrompt: true },
      },
      ...providers.map((p) => ({
        name: `${p.name} (${p.model})`,
        value: { isOnlyPrompt: false, provider: p },
      })),
    ],
  });

  const dirInfo = getReviewDir(isInitial, folderId);
  const { nextNum, lastFile } = getNextReviewMetadata(dirInfo.dir);
  const diff = getGitDiff(start, end, ignorePatterns);

  const templateSuffix = selection.isOnlyPrompt ? "-prompt.md" : ".md";
  const templateName = isInitial
    ? `review-initial${templateSuffix}`
    : `review-validation${templateSuffix}`;

  let finalPrompt = getPromptContent(templateName) + "\n\n---\n";

  if (!isInitial && lastFile) {
    const prevReviewContent = fs.readFileSync(
      path.join(dirInfo.dir, lastFile),
      "utf-8"
    );
    finalPrompt +=
      "PREVIOUS REVIEW:\n" +
      "````markdown\n" +
      prevReviewContent +
      "\n````\n\n---\n";
  }

  finalPrompt += "GIT DIFF:\n" + "````markdown\n" + diff + "\n````";

  const fileName = `r-${String(nextNum).padStart(3, "0")}-${start.slice(
    0,
    7
  )}..${end.slice(0, 7)}.md`;
  const filePath = path.join(dirInfo.dir, fileName);

  if (selection.isOnlyPrompt) {
    fs.writeFileSync(filePath, finalPrompt);
    console.log(`Generated: ${filePath}`);
  } else {
    if (!env.OPENROUTER_API_KEY) {
      console.error(
        "Configuration Error: Missing OPENROUTER_API_KEY environment variable"
      );
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
        provider.config || {}
      );

      fs.writeFileSync(filePath, result || "");
      spinner.succeed(`Review saved: ${filePath}`);
    } catch (error: any) {
      spinner.fail(`AI Review failed: ${error.message}`);
      throw error;
    }
  }
}
