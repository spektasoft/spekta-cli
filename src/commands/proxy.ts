import { executeRtkCommand, isRtkAvailable } from "./proxy-execution";
import { authorizeProxyCommand } from "./proxy-authorization";
import { formatProxyOutput, truncateOutput } from "./proxy-output";
import { validateCommandArguments } from "./proxy-security";

export { isRtkAvailable } from "./proxy-execution";

export { formatProxyOutput, truncateOutput } from "./proxy-output";

export {
  isCommandSafe,
  redactSecrets,
  validateCommandArguments,
} from "./proxy-security";

export async function runRtkProxy(
  command: string,
  rawArgs: string[],
): Promise<void> {
  const cleanArgs = await authorizeProxyCommand(command, rawArgs);

  if (cleanArgs === null) {
    return;
  }

  validateCommandArguments(cleanArgs);

  const result = await executeRtkCommand(command, cleanArgs);

  if (!result.available) {
    console.log(
      [
        "### spekta rtk unavailable",
        "",
        "The `rtk` executable was not found.",
        "Install RTK with the `rtk-ai` package, then retry the command.",
      ].join("\n"),
    );
    return;
  }

  const rawOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");

  const truncated = truncateOutput(rawOutput);

  console.log(
    formatProxyOutput(command, truncated.content, {
      truncated: truncated.truncated,
      exitCode: result.exitCode,
    }),
  );
}
