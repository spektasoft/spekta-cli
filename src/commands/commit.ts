import os from "os";
import path from "path";
import fs from "fs-extra";
import {
  getEnv,
  getProviders,
  getIgnorePatterns,
  getPromptContent,
} from "../config";
import { getStagedDiff } from "../git";
import { promptProviderSelection } from "../ui";
import { executeAiAction } from "../orchestrator";

async function saveToTempFile(
  content: string,
  prefix: string
): Promise<string> {
  const tempFileName = `${prefix}-${Date.now()}.md`;
  const tempFilePath = path.join(os.tmpdir(), tempFileName);
  await fs.writeFile(tempFilePath, content, "utf-8");
  return tempFilePath;
}

export async function runCommit() {
  const [providersData, env, ignorePatterns] = await Promise.all([
    getProviders(),
    getEnv(),
    getIgnorePatterns(),
  ]);

  const diff = await getStagedDiff(ignorePatterns);
  if (!diff) {
    console.error("No staged changes found.");
    return;
  }

  const template = await getPromptContent("commit.md");
  const finalPrompt = template.replace("{{diff}}", diff);

  const selection = await promptProviderSelection(
    finalPrompt,
    providersData.providers,
    "Select provider for commit message:"
  );

  if (selection.isOnlyPrompt) {
    const filePath = await saveToTempFile(finalPrompt, "spekta-prompt");
    console.log(`Generated: ${filePath}`);
    return;
  }

  const result = await executeAiAction({
    apiKey: env.OPENROUTER_API_KEY,
    provider: selection.provider!,
    prompt: finalPrompt,
    spinnerTitle: `Generating commit message using ${
      selection.provider!.model
    }...`,
  });

  const filePath = await saveToTempFile(result, "spekta-commit");
  console.log(`Generated: ${filePath}`);
}
