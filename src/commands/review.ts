import path from "path";
import fs from "fs-extra";
import ora from "ora";
import {
  HOME_PROMPTS,
  getEnv,
  getProviders,
  getIgnorePatterns,
} from "../config";
import { getGitDiff } from "../git";
import { getReviewDir, getNextReviewMetadata } from "../fs-manager";
import { callAI } from "../api";
import { input, confirm, select } from "@inquirer/prompts";

export async function runReview() {
  const { providers } = await getProviders();
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

  const providerId = await select({
    message: "Select provider:",
    choices: [
      { name: "Only Prompt", value: "ONLY_PROMPT" },
      ...providers.map((p: any) => ({ name: p.name, value: p.model })),
    ],
  });

  const selectedProvider = providers.find((p: any) => p.model === providerId);

  const dirInfo = getReviewDir(isInitial, folderId);
  const { nextNum, lastFile } = getNextReviewMetadata(dirInfo.dir);
  const diff = getGitDiff(start, end, ignorePatterns);

  const templateSuffix = providerId === "ONLY_PROMPT" ? "-prompt.md" : ".md";
  const templateName = isInitial
    ? `review-initial${templateSuffix}`
    : `review-validation${templateSuffix}`;
  const templatePath = path.join(HOME_PROMPTS, templateName);

  let finalPrompt = fs.readFileSync(templatePath, "utf-8") + "\n\n---\n";

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

  if (providerId === "ONLY_PROMPT") {
    fs.writeFileSync(filePath, finalPrompt);
    console.log(`Generated: ${filePath}`);
  } else {
    if (!env.OPENROUTER_API_KEY) throw new Error("Missing OPENROUTER_API_KEY");

    const spinner = ora(
      `AI is reviewing your code using ${providerId}...`
    ).start();

    try {
      const result = await callAI(
        env.OPENROUTER_API_KEY,
        providerId,
        finalPrompt,
        selectedProvider?.config || {}
      );

      fs.writeFileSync(filePath, result || "");
      spinner.succeed(`Review saved: ${filePath}`);
    } catch (error: any) {
      spinner.fail(`AI Review failed: ${error.message}`);
      throw error;
    }
  }
}
