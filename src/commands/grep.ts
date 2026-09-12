import { Logger } from "../utils/logger";
import { getGrepContent } from "./grep-search";

export async function runGrep(args?: string[]) {
  try {
    // Basic argument parsing: spekta grep <pattern> [path] [--glob <glob>]
    const safeArgs = args || [];
    const pattern = safeArgs[0];
    const path =
      safeArgs[1] && !safeArgs[1].startsWith("-") ? safeArgs[1] : ".";
    const globIdx = safeArgs.indexOf("--glob");
    const globs = globIdx !== -1 ? safeArgs[globIdx + 1] : undefined;

    if (!pattern) {
      Logger.error("Usage: spekta grep <pattern> [path] [--glob <glob>]");
      process.exit(1);
    }

    const content = await getGrepContent({ pattern, path, globs });
    process.stdout.write(content + "\n");
  } catch (error: any) {
    Logger.error(error.message);
    process.exitCode = 1;
  }
}
