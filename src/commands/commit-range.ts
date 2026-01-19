import { getEnv, getPromptContent, getProviders } from "../config";
import { processOutput } from "../editor-utils";
import {
  formatCommitMessage,
  getCommitMessages,
  resolveHash,
  stripCodeFences,
} from "../git";
import { executeAiAction } from "../orchestrator";
import { promptCommitHash, promptProviderSelection } from "../ui";

export async function runCommitRange() {
  try {
    const args = process.argv.slice(3); // Skip 'node', 'script', 'commit-range'

    let hash1: string;
    let hash2: string;

    // Check if hashes provided as CLI arguments
    if (args.length >= 2) {
      hash1 = args[0];
      hash2 = args[1];
      console.log(`Using provided hashes: ${hash1}..${hash2}`);
    } else {
      // Interactive prompts
      hash1 = await promptCommitHash(
        "Enter first commit hash (older):",
        (value) => {
          if (!value || value.trim().length === 0) {
            return "Commit hash is required";
          }
          return true;
        },
      );

      hash2 = await promptCommitHash(
        "Enter second commit hash (newer):",
        (value) => {
          if (!value || value.trim().length === 0) {
            return "Commit hash is required";
          }
          return true;
        },
      );
    }

    // Resolve hashes to full commit references
    const resolvedHash1 = await resolveHash(hash1.trim());
    const resolvedHash2 = await resolveHash(hash2.trim());

    console.log(
      `\nResolved range: ${resolvedHash1.substring(0, 7)}..${resolvedHash2.substring(0, 7)}`,
    );

    // Fetch commit messages
    const commitMessages = await getCommitMessages(
      resolvedHash1,
      resolvedHash2,
    );

    // Validate non-empty range
    if (!commitMessages || commitMessages.trim().length === 0) {
      throw new Error(
        `No commits found in range ${resolvedHash1.substring(0, 7)}..${resolvedHash2.substring(0, 7)}. ` +
          `Ensure hash1 is older than hash2.`,
      );
    }

    console.log(`Found commits in range.`);

    // Warn for large commit ranges
    const COMMIT_WARNING_THRESHOLD = 20000; // characters
    if (commitMessages.length > COMMIT_WARNING_THRESHOLD) {
      console.warn(
        `\nWarning: Commit range is large (${commitMessages.length} characters).`,
      );
      console.warn(
        `This may consume significant tokens and take longer to process.\n`,
      );
    }

    // Load system prompt and build user context
    const systemPrompt = await getPromptContent("commit-range.md");
    const userContext = `### COMMIT MESSAGES\n\`\`\`\n${commitMessages}\n\`\`\``;

    // Get providers and prompt for selection
    const [providersData, env] = await Promise.all([getProviders(), getEnv()]);

    const selection = await promptProviderSelection(
      systemPrompt + "\n" + userContext,
      providersData.providers,
      "Select provider for commit message generation:",
    );

    // Handle "Only Prompt" option
    if (selection.isOnlyPrompt) {
      await processOutput(
        systemPrompt + "\n" + userContext,
        "spekta-commit-range-prompt",
      );
      console.log("Prompt saved. No LLM call made.");
      return;
    }

    if (!selection.provider) {
      throw new Error("No AI provider selected for commit range generation.");
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
      spinnerTitle: "Generating consolidated commit message...",
    });

    // Process result
    const cleaned = stripCodeFences(result);
    const formatted = await formatCommitMessage(cleaned);

    // Save to file and optionally open in editor
    const outputPath = await processOutput(formatted, "spekta-commit-range");

    console.log("\nConsolidated commit message generated successfully.");
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
