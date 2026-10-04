import { Logger } from "../utils/logger";
import { getGrepOutcome } from "./grep-search";

export async function runGrep(args?: string[]) {
  try {
    // Basic argument parsing: spekta grep <pattern> [path] [--glob <glob>]...
    const safeArgs = args || [];
    const pattern = safeArgs[0];
    const path =
      safeArgs[1] && !safeArgs[1].startsWith("-") ? safeArgs[1] : ".";

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
    });
    if (outcome.status === "engine_failure") {
      if (outcome.message) Logger.error(outcome.message);
      process.exitCode = 1;
      return;
    }
    const content =
      outcome.status === "success" ? outcome.value : outcome.message;
    process.stdout.write(content + "\n");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    Logger.error(message);
    process.exitCode = 1;
  }
}
