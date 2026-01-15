import { getEnv, getProviders, getPromptContent } from "../config";
import {
  getNearestMerge,
  getInitialCommit,
  resolveHash,
  getCommitMessages,
} from "../git";
import { promptHashRange } from "../git-ui";
import { promptProviderSelection } from "../ui";
import { executeAiAction } from "../orchestrator";
import { saveToTempFile, openEditor } from "../editor-utils";

export async function runPr() {
  const [env, providersData] = await Promise.all([getEnv(), getProviders()]);

  const suggestedEnd = await resolveHash("HEAD");
  const nearestMerge = await getNearestMerge();
  const suggestedStart = nearestMerge || (await getInitialCommit());

  const { start, end } = await promptHashRange(suggestedStart, suggestedEnd);
  const commitMessages = await getCommitMessages(start, end);

  const template = await getPromptContent("pull-request.md");
  const finalPrompt = template.replace("{{commit_messages}}", commitMessages);

  const selection = await promptProviderSelection(
    finalPrompt,
    providersData.providers,
    "Select provider for PR message:"
  );

  if (selection.isOnlyPrompt) {
    const filePath = await saveToTempFile(finalPrompt, "spekta-pr-prompt");
    console.log(`Prompt saved to: ${filePath}`);
    return;
  }

  const result = await executeAiAction({
    apiKey: env.OPENROUTER_API_KEY,
    provider: selection.provider!,
    prompt: finalPrompt,
    spinnerTitle: `Generating PR message using ${selection.provider!.model}...`,
  });

  const filePath = await saveToTempFile(result, "spekta-pr");
  console.log(`PR message generated: ${filePath}`);

  const editor = env.SPEKTA_EDITOR;
  if (editor) {
    await openEditor(editor, filePath);
  } else {
    console.log("Tip: Set SPEKTA_EDITOR in .env to open automatically.");
  }
}
