import { Logger } from "../utils/logger";
import { getGrepContent } from "./grep-search";

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

    const content = await getGrepContent({
      pattern,
      path,
      globs: globs.length > 0 ? globs.join(",") : undefined,
    });
    process.stdout.write(content + "\n");
  } catch (error: any) {
    Logger.error(error.message);
    process.exitCode = 1;
  }
}
