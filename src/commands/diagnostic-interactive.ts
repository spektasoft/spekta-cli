import { input } from "@inquirer/prompts";
import { isCancel } from "../ui/ui";
import { runDiagnostic } from "./diagnostic";

export async function runDiagnosticInteractive(): Promise<void> {
  let target: string;
  try {
    target = await input({
      message: "Target file or directory (leave empty for current directory):",
    });
  } catch (error: any) {
    if (error?.name === "ExitPromptError") {
      return;
    }
    throw error;
  }

  const trimmed = target.trim();
  if (isCancel(trimmed)) {
    return;
  }

  const resolvedTarget = trimmed.length === 0 ? "." : trimmed;
  await runDiagnostic([resolvedTarget]);
}
