import { execa } from "execa";

export type RtkExecutionResult =
  | {
      available: false;
    }
  | {
      available: true;
      stdout: string;
      stderr: string;
      exitCode: number;
    };

export async function executeRtkCommand(
  command: string,
  args: string[],
): Promise<RtkExecutionResult> {
  try {
    const result = await execa("rtk", [command, ...args], {
      reject: false,
      env: {
        ...process.env,
        NO_COLOR: "1",
        TERM: "dumb",
      },
    });

    return {
      available: true,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 0,
    };
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";

    if (code === "ENOENT" || code === "ENOTFOUND") {
      return { available: false };
    }

    throw error;
  }
}

export async function isRtkAvailable(): Promise<boolean> {
  try {
    await execa("rtk", ["--version"]);
    return true;
  } catch {
    return false;
  }
}
