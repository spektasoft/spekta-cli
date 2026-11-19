import { homedir } from "node:os";

/** Resolve the host user's home directory without relying on Unix-only HOME. */
export function getUserHomeDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  fallback = homedir(),
): string {
  if (platform === "win32") return environment.USERPROFILE || fallback;
  return environment.HOME || fallback;
}
