import { Logger } from "../utils/logger";
import { getGrepOutcome } from "./grep-search";

export async function runGrep(args?: string[]) {
  try {
    // Basic argument parsing: spekta grep <pattern> [path] [--glob <glob>]...
    const safeArgs = args || [];
    const caseInsensitive = safeArgs.includes("--ignore-case");
    const positional = safeArgs.filter((arg) => arg !== "--ignore-case");
    const pattern = positional[0];
    const path =
      positional[1] && !positional[1].startsWith("-") ? positional[1] : ".";

    // Collect every --glob occurrence, not just the first, so multiple
    // --glob flags in one invocation are all honored.
    const globs: string[] = [];
    for (let i = 0; i < safeArgs.length; i++) {
      if (safeArgs[i] === "--glob" && safeArgs[i + 1]) {
        globs.push(safeArgs[i + 1]);
      }
    }

    if (!pattern) {
      Logger.error("Usage: spekta grep <pattern> [path] [--glob <glob>]...");
      process.exit(1);
    }

    const outcome = await getGrepOutcome({
      pattern,
      path,
      globs: globs.length > 0 ? globs.join(",") : undefined,
      ...(caseInsensitive ? { case_insensitive: true } : {}),
    });
    if (
      outcome.status === "engine_failure" ||
      outcome.status === "policy_rejection"
    ) {
      if (outcome.message) Logger.error(outcome.message);
      process.exitCode = 1;
      return;
    }
    const content =
      outcome.status === "success" ? outcome.value : outcome.message;
    process.stdout.write(content + "\n");
  } catch {
    Logger.error("Search failed.");
    process.exitCode = 1;
  }
}
