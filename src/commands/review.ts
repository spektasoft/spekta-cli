import path from "path";
import fs from "fs-extra";
import { HOME_PROMPTS, getEnv, getProviders } from "../config";
import { getGitDiff } from "../git";
import { getReviewDir, getNextReviewMetadata } from "../fs-manager";
import { callAI } from "../api";
import { input, confirm, select } from "@inquirer/prompts";

export async function runReview() {
  const { providers } = await getProviders();
  const env = getEnv();

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
      ...providers.map((p: any) => ({ name: p.name, value: p.id })),
    ],
  });

  const dirInfo = getReviewDir(isInitial, folderId);
  const { nextNum, lastFile } = getNextReviewMetadata(dirInfo.dir);
  const diff = getGitDiff(start, end);

  const templateSuffix = providerId === "ONLY_PROMPT" ? "-prompt.md" : ".md";
  const templateName = isInitial
    ? `review-initial${templateSuffix}`
    : `review-validation${templateSuffix}`;
  const templatePath = path.join(HOME_PROMPTS, templateName);

  let finalPrompt = fs.readFileSync(templatePath, "utf-8") + "\n\n---\n";
  if (!isInitial && lastFile) {
    finalPrompt +=
      "PREVIOUS REVIEW:\n" +
      fs.readFileSync(path.join(dirInfo.dir, lastFile), "utf-8") +
      "\n\n---\n";
  }
  finalPrompt += "GIT DIFF:\n" + diff;

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
    const result = await callAI(
      env.OPENROUTER_API_KEY,
      providerId,
      finalPrompt
    );
    fs.writeFileSync(filePath, result || "");
    console.log(`Review saved: ${filePath}`);
  }
}
