import fs from "fs-extra";
import { registerCleanup } from "../utils/process";
import {
  getIgnorePatterns,
  getPromptContent,
  getProviders,
} from "../core/config";
import { processOutput } from "../utils/editor-utils";
import {
  commitWithFile,
  formatCommitMessage,
  getStagedDiff,
  stripCodeFences,
} from "../git/git";
import { executeAiAction } from "../core/orchestrator";
import { confirmCommit, promptProviderSelection } from "../ui/ui";
import { Provider } from "../core/config";

type CommitOperation = "prompt-only" | "generate" | "commit";

interface CommitArgs {
  operation: CommitOperation;
  model?: string;
  interactive: boolean;
  noEditor: boolean;
  stdout: boolean;
}

export function parseCommitArgs(args: string[] = []): CommitArgs {
  let operation: CommitOperation | undefined;
  let explicitOperation = false;
  let model: string | undefined;
  let interactive = false;
  let noEditor = false;
  let stdout = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--interactive") interactive = true;
    else if (arg === "--prompt-only") {
      explicitOperation = true;
      operation = setOperation(operation, "prompt-only");
    }
    else if (arg === "--message") {
      explicitOperation = true;
      operation = setOperation(operation, "generate");
    }
    else if (arg === "--commit") {
      explicitOperation = true;
      operation = setOperation(operation, "commit");
    }
    else if (arg === "--model") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --model");
      model = value;
    }
    else if (arg === "--no-editor") noEditor = true;
    else if (arg === "--stdout") stdout = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else throw new Error(`Unexpected argument: ${arg}`);
  }

  operation ??= interactive ? "generate" : "prompt-only";
  if (interactive && explicitOperation) throw new Error("--interactive cannot be combined with --prompt-only, --message, or --commit");
  if (operation === "prompt-only" && model) throw new Error("--prompt-only cannot be combined with --model");
  if ((operation === "generate" || operation === "commit") && !interactive && !model) throw new Error("--model is required with --message and --commit");
  if (operation === "commit" && stdout) throw new Error("--commit cannot be combined with --stdout");
  return { operation, model, interactive, noEditor, stdout };
}

function setOperation(current: CommitOperation | undefined, next: CommitOperation): CommitOperation {
  if (current) throw new Error("Only one of --prompt-only, --message, or --commit may be specified");
  return next;
}

export function resolveProvider(selector: string, providers: Provider[]): Provider {
  const matches = providers.filter((provider) => provider.name === selector || provider.model === selector);
  if (!matches.length) throw new Error(`Unknown provider or model "${selector}".`);
  if (matches.length > 1) throw new Error(`Ambiguous provider or model "${selector}". Matches: ${matches.map((p) => `${p.name} (${p.model})`).join(", ")}`);
  return matches[0];
}

export async function generateCommitMessage(provider: Provider, systemPrompt: string, userContext: string, quiet = false): Promise<string> {
  const result = await executeAiAction({
    provider,
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContext }],
    spinnerTitle: "Generating commit message...",
    quiet,
  });
  return formatCommitMessage(stripCodeFences(result));
}

export async function runCommit(args: string[] = []) {
  let tempFilePath: string | undefined;

  // Cleanup handler for manual escapes
  const cleanup = async () => {
    if (tempFilePath && (await fs.pathExists(tempFilePath))) {
      await fs.remove(tempFilePath);
    }
  };

  const unregister = registerCleanup(cleanup);

  try {
    const options = parseCommitArgs(args);
    const ignorePatterns = await getIgnorePatterns();

    const diff = await getStagedDiff(ignorePatterns);
    if (!diff) {
      console.error("No staged changes found.");
      process.exitCode = 1;
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
    const promptContent = systemPrompt + "\n" + userContext;

    if (options.operation === "prompt-only" && options.stdout) {
      process.stdout.write(promptContent);
      return;
    }

    if (options.operation === "prompt-only") {
      await processOutput(promptContent, "spekta-prompt", true, true);
      return;
    }

    const providersData = await getProviders();

    const selection = options.interactive
      ? await promptProviderSelection(promptContent, providersData.providers)
      : { isOnlyPrompt: false, provider: resolveProvider(options.model!, providersData.providers) };

    if (selection.isOnlyPrompt) {
      await processOutput(
        promptContent,
        "spekta-prompt",
        false,
        options.noEditor,
      );
      return;
    }

    if (!selection.provider) {
      throw new Error("No AI provider selected for commit generation.");
    }

    const formatted = await generateCommitMessage(selection.provider, systemPrompt, userContext, !options.interactive);

    if (options.stdout) {
      process.stdout.write(formatted);
      return;
    }

    if (options.operation === "commit") {
      tempFilePath = await processOutput(formatted, "spekta-commit", true, true);
      await commitWithFile(tempFilePath);
      console.log("Commit created successfully.");
      return;
    }

    // 2. Single I/O operation
    tempFilePath = await processOutput(
      formatted,
      "spekta-commit",
      false,
      options.noEditor,
    );

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
