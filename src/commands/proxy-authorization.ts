import { confirm } from "@inquirer/prompts";
import { isCommandSafe, redactSecrets } from "./proxy-security";

const FORCE_FLAG = "--spekta-force";

export async function authorizeProxyCommand(
  command: string,
  rawArgs: string[],
): Promise<string[] | null> {
  const forced = rawArgs.includes(FORCE_FLAG);
  const cleanArgs = rawArgs.filter((arg) => arg !== FORCE_FLAG);

  if (forced || isCommandSafe(command, cleanArgs)) {
    return cleanArgs;
  }

  if (process.stdin.isTTY) {
    const confirmed = await confirm({
      message: `The command "${redactSecrets(
        [command, ...cleanArgs].join(" "),
      )}" may modify or delete data. Continue?`,
      default: false,
    });

    return confirmed ? cleanArgs : null;
  }

  console.log(
    [
      "### spekta security advisory",
      "",
      "The requested command is classified as mutating or destructive.",
      "Execution was blocked because the process is non-interactive.",
      "",
      "Append `--spekta-force` to explicitly authorize this command.",
    ].join("\n"),
  );

  return null;
}
