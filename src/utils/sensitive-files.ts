import path from "node:path";

const SENSITIVE_EXTENSIONS = [
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore",
];
const SENSITIVE_NAMES = [".npmrc", ".netrc", "credentials"];

export function isSensitivePath(targetPath: string): boolean {
  const name = path.posix.basename(targetPath.replaceAll("\\", "/"));
  if (name === ".env.example") return false;
  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    SENSITIVE_NAMES.includes(name) ||
    SENSITIVE_EXTENSIONS.some((extension) => name.endsWith(extension))
  );
}

export function hasExactSensitiveException(
  relativePath: string,
  workspacePatterns: readonly string[],
): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  return workspacePatterns.some((pattern) => {
    if (!pattern.startsWith("!")) return false;
    const candidate = pattern.slice(1);
    if (
      !candidate ||
      candidate.startsWith("/") ||
      /[\\*?[\]]/.test(candidate) ||
      candidate
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    )
      return false;
    return candidate === normalized;
  });
}
