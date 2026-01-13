import ora from "ora";
import os from "os";
import path from "path";
import fs from "fs-extra";
import {
  getEnv,
  getProviders,
  getIgnorePatterns,
  getPromptContent,
  Provider,
} from "../config";
import { getStagedDiff } from "../git";
import { callAI } from "../api";
import { select } from "@inquirer/prompts";

/**
 * Persists content to a temporary file and logs the path.
 * Crashes gracefully on failure.
 */
async function saveToTempFile(
  content: string,
  prefix: string
): Promise<string> {
  const tempFileName = `${prefix}-${Date.now()}.md`;
  const tempFilePath = path.join(os.tmpdir(), tempFileName);

  try {
    await fs.writeFile(tempFilePath, content, "utf-8");
    return tempFilePath;
  } catch (error: any) {
    throw new Error(
      `Fatal File System Error: Could not write to ${tempFilePath}. ${error.message}`
    );
  }
}

export async function runCommit() {
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

  const diff = await getStagedDiff(ignorePatterns);

  if (!diff) {
    console.error("No staged changes found. Please stage your changes first.");
    return;
  }

  const selection = await select<{
    isOnlyPrompt: boolean;
    provider?: Provider;
  }>({
    message: "Select provider for commit message generation:",
    choices: [
      { name: "Only Prompt", value: { isOnlyPrompt: true } },
      ...providers.map((p) => ({
        name: `${p.name} (${p.model})`,
        value: { isOnlyPrompt: false, provider: p },
      })),
    ],
  });

  const template = await getPromptContent("commit.md");
  const finalPrompt = template.replace("{{diff}}", diff);

  if (selection.isOnlyPrompt) {
    const filePath = await saveToTempFile(finalPrompt, "spekta-prompt");
    console.log(`Generated: ${filePath}`);
    return;
  }

  if (!env.OPENROUTER_API_KEY) {
    console.error("Configuration Error: Missing OPENROUTER_API_KEY");
    return;
  }

  const provider = selection.provider!;
  const spinner = ora(
    `Generating commit message using ${provider.model}...`
  ).start();

  try {
    const result = await callAI(
      env.OPENROUTER_API_KEY,
      provider.model,
      finalPrompt,
      provider.config || {}
    );

    spinner.succeed("Commit message generated.");

    const filePath = await saveToTempFile(result, "spekta-commit");
    console.log(`Generated: ${filePath}`);
  } catch (error: any) {
    if (spinner.isSpinning) {
      spinner.fail(`Generation failed: ${error.message}`);
    } else {
      console.error(`Error: ${error.message}`);
    }
    throw error;
  }
}
