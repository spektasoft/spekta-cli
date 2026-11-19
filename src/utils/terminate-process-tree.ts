import { execa } from "execa";

type KillableProcess = {
  pid?: number;
  kill?: (signal?: NodeJS.Signals) => unknown;
};

/** Terminates a Windows child and its descendants; other platforms keep their existing group handling. */
export async function terminateWindowsProcessTree(
  child: KillableProcess,
  signal: NodeJS.Signals = "SIGTERM",
): Promise<void> {
  if (process.platform !== "win32" || !child.pid) {
    child.kill?.(signal);
    return;
  }

  const result = await execa("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
    reject: false,
    timeout: 10_000,
    windowsHide: true,
  }).catch(() => undefined);
  if (!result || result.failed) {
    try {
      child.kill?.(signal);
    } catch {
      // The owned child may have exited while taskkill was running.
    }
  }
}
