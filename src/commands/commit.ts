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
import { openEditor } from "../editor-utils";

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

    // Pre-validate API key before calling orchestrator
    if (!env.OPENROUTER_API_KEY) {
      console.error(
        "Configuration Error: Missing OPENROUTER_API_KEY. Please set it in your .env file."
      );
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
    console.log(`Commit message generated: ${filePath}`);

    const editor = env.SPEKTA_EDITOR;
    if (editor) {
      await openEditor(editor, filePath);
    }
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
