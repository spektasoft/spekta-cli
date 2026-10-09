import { Logger } from "../utils/logger";
import { getRgOutcome } from "./grep-search";

/** Supported native subset of `spekta rg` operand parsing. */
export async function runRg(args?: string[]) {
  const patterns: string[] = [];
  const operands: string[] = [];
  let endOptions = false;
  const values = args ?? [];
  for (let index = 0; index < values.length; index++) {
    const arg = values[index];
    if (endOptions) {
      operands.push(arg);
      continue;
    }
    if (arg === "--") {
      endOptions = true;
      continue;
    }
    if (arg === "-e" || arg === "--regexp") {
      if (index + 1 >= values.length) {
        Logger.error(`Option ${arg} requires a pattern.`);
        process.exitCode = 1;
        return;
      }
      patterns.push(values[++index]);
      continue;
    }
    if (arg.startsWith("--regexp=")) {
      patterns.push(arg.slice("--regexp=".length));
      continue;
    }
    if (arg.startsWith("-")) {
      Logger.error(`Unsupported ripgrep option: ${arg}`);
      process.exitCode = 1;
      return;
    }
    operands.push(arg);
  }
  const finalPatterns = patterns.length ? patterns : operands.splice(0, 1);
  if (
    !finalPatterns.length ||
    finalPatterns.some((pattern) => !pattern.trim())
  ) {
    Logger.error(
      "A nonempty regular expression is required. Usage: spekta rg [-e PATTERN]... [PATTERN] [PATH]... [-- PATH]...",
    );
    process.exitCode = 1;
    return;
  }

  try {
    const outcome = await getRgOutcome({
      patterns: finalPatterns,
      paths: operands,
      globs: [],
      case_mode: "sensitive",
    });
    if (
      outcome.status === "engine_failure" ||
      outcome.status === "policy_rejection"
    ) {
      if (outcome.message) Logger.error(outcome.message);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      (outcome.status === "success" ? outcome.value : outcome.message) + "\n",
    );
  } catch {
    Logger.error("Search failed.");
    process.exitCode = 1;
  }
}
