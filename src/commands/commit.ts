import fs from "fs-extra";
import {
  getEnv,
  getIgnorePatterns,
  getPromptContent,
  getProviders,
} from "../config";
import {
  finalizeOutput,
  prepareTempMessageFile,
  saveToTempFile,
} from "../editor-utils";
import {
  commitWithFile,
  formatWithPrettier,
  getStagedDiff,
  stripCodeFences,
} from "../git";
import { executeAiAction } from "../orchestrator";
import { confirmCommit, promptProviderSelection } from "../ui";

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
        `Warning: Staged diff is large (${diff.length} characters).`,
      );
    }

    const systemPrompt = await getPromptContent("commit.md");
    const userContext = `### GIT STAGED DIFF\n\`\`\`markdown\n${diff}\n\`\`\``;

    const selection = await promptProviderSelection(
      systemPrompt + "\n" + userContext,
      providersData.providers,
    );

    if (selection.isOnlyPrompt) {
      await finalizeOutput(
        systemPrompt + "\n" + userContext,
        "spekta-prompt",
        "Prompt saved",
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

    // Clean & format
    const cleaned = stripCodeFences(result);

    // Write initial version
    const filePath = await saveToTempFile(cleaned, "spekta-commit-raw");

    // Format with Prettier
    await formatWithPrettier(filePath);

    // Prepare (show/print + editor if set)
    const finalFilePath = await prepareTempMessageFile(
      (await fs.readFile(filePath, "utf-8")).trim(),
      "spekta-commit",
    );

    // Only offer commit in normal flow (not isOnlyPrompt)
    if (selection.isOnlyPrompt) {
      console.log("Prompt-only mode – no commit offered.");
      await fs.remove(finalFilePath);
      return;
    }

    const shouldCommit = await confirmCommit();

    if (shouldCommit) {
      await commitWithFile(finalFilePath);
      console.log("Commit created successfully.");
    } else {
      console.log("Commit aborted.");
    }

    // Cleanup in all cases
    await fs.remove(finalFilePath);
    if (filePath !== finalFilePath) {
      await fs.remove(filePath);
    }
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
