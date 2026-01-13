import ora from "ora";
import {
  getEnv,
  getProviders,
  getIgnorePatterns,
  getPromptContent,
  Provider,
} from "../config";
import { getStagedDiff } from "../git";
import { callAI } from "../api";
import { select } from "@inquirer/prompts";

export async function runCommit() {
  let providersData;
  try {
    providersData = await getProviders();
  } catch (error: any) {
    console.error(`Configuration Error: ${error.message}`);
    return;
  }

  const { providers } = providersData;
  const env = await getEnv();
  const ignorePatterns = await getIgnorePatterns();

  const diff = await getStagedDiff(ignorePatterns);

  if (!diff) {
    console.error("No staged changes found. Please stage your changes first.");
    return;
  }

  const selection = await select<{
    isOnlyPrompt: boolean;
    provider?: Provider;
  }>({
    message: "Select provider for commit message generation:",
    choices: [
      { name: "Only Prompt", value: { isOnlyPrompt: true } },
      ...providers.map((p) => ({
        name: `${p.name} (${p.model})`,
        value: { isOnlyPrompt: false, provider: p },
      })),
    ],
  });

  const template = await getPromptContent("commit.md");
  const finalPrompt = template.replace("{{diff}}", diff);

  if (selection.isOnlyPrompt) {
    console.log("\n--- GENERATED PROMPT ---\n");
    console.log(finalPrompt);
    return;
  }

  if (!env.OPENROUTER_API_KEY) {
    console.error("Configuration Error: Missing OPENROUTER_API_KEY");
    return;
  }

  const provider = selection.provider!;
  const spinner = ora(
    `Generating commit message using ${provider.model}...`
  ).start();

  try {
    const result = await callAI(
      env.OPENROUTER_API_KEY,
      provider.model,
      finalPrompt,
      provider.config || {}
    );

    spinner.succeed("Commit message generated:");
    console.log("\n" + result + "\n");
  } catch (error: any) {
    spinner.fail(`Generation failed: ${error.message}`);
    process.exit(1);
  }
}
