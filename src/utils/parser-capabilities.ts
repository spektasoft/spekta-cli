export const WINDOWS_OVERVIEW_UNAVAILABLE =
  "unsupported_operation: Structural overview is unavailable on Windows. Use an ordinary read without --overview.";

export function isStructuralOverviewUnavailable(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32";
}
