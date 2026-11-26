import path from "node:path";

const SENSITIVE_EXTENSIONS = [
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore",
];
const SENSITIVE_NAMES = [".npmrc", ".netrc", "credentials", "id_rsa"];

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
    const directive = "allow-sensitive:";
    if (!pattern.startsWith(directive)) return false;
    const candidate = pattern.slice(directive.length).trim();
    if (
      !candidate ||
      path.posix.isAbsolute(candidate) ||
      path.win32.isAbsolute(candidate) ||
      /[\\*?[\]]/.test(candidate) ||
      Array.from(candidate).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      candidate
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    )
      return false;
    return candidate === normalized;
  });
}
