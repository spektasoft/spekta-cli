import { getEnv, getPromptContent, getProviders } from "../config";
import { processOutput } from "../editor-utils";
import {
  getCommitMessages,
  resolveHash,
  sanitizeMessageForPrompt,
} from "../git";
import { executeAiAction } from "../orchestrator";
import {
  confirmLargePayload,
  getTokenCount,
  promptCommitHash,
  promptProviderSelection,
} from "../ui";

export async function runSummarize() {
  try {
    const args = process.argv.slice(3); // Skip 'node', 'script', 'summarize'

    let hash1Raw: string;
    let hash2Raw: string;

    // Check if hashes provided as CLI arguments
    if (args.length >= 2) {
      hash1Raw = args[0];
      hash2Raw = args[1];
      console.log(`Using provided hashes: ${hash1Raw}..${hash2Raw}`);
    } else {
      // Interactive prompts - allow symbolic references
      hash1Raw = await promptCommitHash(
        "Enter first commit (older, supports symbolic refs like HEAD~1, branch names, etc.):",
        (value) => {
          if (!value || value.trim().length === 0) {
            return "Commit reference is required";
          }
          return true;
        },
      );

      hash2Raw = await promptCommitHash(
        "Enter second commit (newer, supports symbolic refs like HEAD, branch names, etc.):",
        (value) => {
          if (!value || value.trim().length === 0) {
            return "Commit reference is required";
          }
          return true;
        },
      );
    }

    // Resolve symbolic references to actual hashes
    const resolvedHash1 = await resolveHash(hash1Raw.trim());
    const resolvedHash2 = await resolveHash(hash2Raw.trim());

    console.log(`\nResolved: ${hash1Raw} -> ${resolvedHash1.substring(0, 7)}`);
    console.log(`Resolved: ${hash2Raw} -> ${resolvedHash2.substring(0, 7)}`);
    console.log(
      `\nProcessing range: ${resolvedHash1.substring(0, 7)}..${resolvedHash2.substring(0, 7)}`,
    );

    // Fetch commit messages
    const commitMessages = await getCommitMessages(
      resolvedHash1,
      resolvedHash2,
    );

    // Validate non-empty range
    if (!commitMessages || commitMessages.trim() === "") {
      console.error("\nError: No commits found in the specified range.");
      console.error(
        "Note: Ensure the first commit is an ancestor of the second.",
      );
      process.exitCode = 1;
      return;
    }

    console.log(`Found commits in range.`);

    // Load system prompt and build user context
    const systemPrompt = await getPromptContent("summary.md");
    const sanitizedMessages = sanitizeMessageForPrompt(commitMessages);
    const userContext = `### COMMIT HISTORY
<commit_history>
${sanitizedMessages}
</commit_history>

Analyze ONLY the content within <commit_history> tags. Generate a structured state snapshot as defined in the system prompt.`;

    // Token validation with confirmation gate
    const fullPrompt = systemPrompt + "\n" + userContext;
    const tokenCount = getTokenCount(fullPrompt);
    const TOKEN_WARNING_THRESHOLD = 5000;

    if (tokenCount > TOKEN_WARNING_THRESHOLD) {
      const shouldProceed = await confirmLargePayload(tokenCount);
      if (!shouldProceed) {
        console.log("Operation cancelled by user due to payload size.");
        const saveOnly = await processOutput(
          fullPrompt,
          "spekta-summarize-large",
        );
        return;
      }
    }

    // Get providers and prompt for selection
    const [providersData, env] = await Promise.all([getProviders(), getEnv()]);

    const selection = await promptProviderSelection(
      systemPrompt + "\n" + userContext,
      providersData.providers,
      "Select provider for state snapshot generation:",
    );

    // Handle "Only Prompt" option
    if (selection.isOnlyPrompt) {
      await processOutput(
        systemPrompt + "\n" + userContext,
        "spekta-summarize-prompt",
      );
      console.log("Prompt saved. No LLM call made.");
      return;
    }

    if (!selection.provider) {
      throw new Error("No AI provider selected for state snapshot generation.");
    }

    console.log(`Selected provider: ${selection.provider.name}`);

    // Execute LLM call
    const result = await executeAiAction({
      apiKey: env.OPENROUTER_API_KEY,
      provider: selection.provider,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContext },
      ],
      spinnerTitle: "Generating state snapshot...",
    });

    // Save to file and optionally open in editor (via SPEKTA_EDITOR)
    const outputPath = await processOutput(result, "spekta-summarize");

    console.log("\nState snapshot generated successfully.");
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
