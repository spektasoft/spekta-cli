import fs from "fs-extra";
import { registerCleanup } from "../utils/process";
import {
  getEnv,
  getIgnorePatterns,
  getPromptContent,
  getProviders,
} from "../config";
import { processOutput } from "../editor-utils";
import {
  commitWithFile,
  formatCommitMessage,
  getStagedDiff,
  stripCodeFences,
} from "../git";
import { executeAiAction } from "../orchestrator";
import { confirmCommit, promptProviderSelection } from "../ui";

export async function runCommit() {
  let tempFilePath: string | undefined;

  // Cleanup handler for manual escapes
  const cleanup = async () => {
    if (tempFilePath && (await fs.pathExists(tempFilePath))) {
      await fs.remove(tempFilePath);
    }
  };

  const unregister = registerCleanup(cleanup);

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
      await processOutput(systemPrompt + "\n" + userContext, "spekta-prompt");
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

    // 1. Process in-memory
    const cleaned = stripCodeFences(result);
    const formatted = await formatCommitMessage(cleaned);

    // 2. Single I/O operation
    tempFilePath = await processOutput(formatted, "spekta-commit");

    if (await confirmCommit()) {
      await commitWithFile(tempFilePath);
      console.log("Commit created successfully.");
    } else {
      console.log("Commit aborted.");
    }
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    // 3. Guaranteed cleanup
    await cleanup();
    unregister();
  }
}
