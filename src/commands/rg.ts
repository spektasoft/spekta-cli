import { Logger } from "../utils/logger";
import { getRgOutcome } from "./grep-search";

/** Basic public `spekta rg <pattern> [path]` interface. */
export async function runRg(args?: string[]) {
  const [pattern, path = ".", ...extra] = args ?? [];
  if (!pattern || extra.length > 0) {
    Logger.error("Usage: spekta rg <pattern> [path]");
    process.exitCode = 1;
    return;
  }

  try {
    const outcome = await getRgOutcome({
      patterns: [pattern],
      paths: path === "." ? [] : [path],
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
