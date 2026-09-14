export function redactSecrets(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]")
    .replace(
      /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+/g,
      "[REDACTED]",
    )
    .replace(/\bglpat-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED]")
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
      "[REDACTED]",
    )
    .replace(
      /((?:^|[^\w-])(["'`]?)(?:api[-_]?key|x-api-key)\2\s*[:=]\s*)(["'`]?)([^"'`,}\s]+)\3/gi,
      "$1$3[REDACTED]$3",
    );
}
