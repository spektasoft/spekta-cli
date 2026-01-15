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
import { finalizeOutput } from "../editor-utils";

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
  try {
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

    const DIFF_WARNING_THRESHOLD = 30000;
    if (diff.length > DIFF_WARNING_THRESHOLD) {
      console.warn(
        `Warning: Staged diff is large (${diff.length} characters).`
      );
    }

    const systemPrompt = await getPromptContent("commit.md");
    const userContext = `### GIT STAGED DIFF\n\`\`\`markdown\n${diff}\n\`\`\``;

    const selection = await promptProviderSelection(
      systemPrompt + "\n" + userContext,
      providersData.providers
    );

    if (selection.isOnlyPrompt) {
      await finalizeOutput(
        systemPrompt + "\n" + userContext,
        "spekta-prompt",
        "Prompt saved"
      );
      return;
    }

    const result = await executeAiAction({
      apiKey: env.OPENROUTER_API_KEY,
      provider: selection.provider!,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContext },
      ],
      spinnerTitle: "Generating commit message...",
    });

    await finalizeOutput(result, "spekta-commit", "Commit message generated");
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
