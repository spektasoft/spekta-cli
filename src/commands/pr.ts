import { getEnv, getProviders, getPromptContent } from "../config";
import {
  getNearestMerge,
  getInitialCommit,
  resolveHash,
  getCommitMessages,
  stripCodeFences,
  formatCommitMessage,
} from "../git";
import { promptHashRange } from "../git-ui";
import { promptProviderSelection } from "../ui";
import { executeAiAction } from "../orchestrator";
import { processOutput } from "../editor-utils";

export async function runPr() {
  const [env, providersData] = await Promise.all([getEnv(), getProviders()]);

  const suggestedEnd = await resolveHash("HEAD");
  const nearestMerge = await getNearestMerge();
  const suggestedStart = nearestMerge || (await getInitialCommit());

  const { start, end } = await promptHashRange(suggestedStart, suggestedEnd);
  const commitMessages = await getCommitMessages(start, end);

  const systemPrompt = await getPromptContent("pull-request.md");
  const userContext = `### COMMIT MESSAGES\n\`\`\`markdown\n${commitMessages}\n\`\`\``;

  const selection = await promptProviderSelection(
    systemPrompt + "\n" + userContext,
    providersData.providers,
    "Select provider for PR message:",
  );

  if (selection.isOnlyPrompt) {
    await processOutput(systemPrompt + "\n" + userContext, "spekta-pr-prompt");
    return;
  }

  const result = await executeAiAction({
    apiKey: env.OPENROUTER_API_KEY,
    provider: selection.provider!,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContext },
    ],
    spinnerTitle: "Generating PR message...",
  });

  // Use the new standardized pipeline
  const cleaned = stripCodeFences(result);
  const formatted = await formatCommitMessage(cleaned);

  await processOutput(formatted, "spekta-pr");
}
