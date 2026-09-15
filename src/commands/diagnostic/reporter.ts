import { DiagnosticPolicy, ScanResult } from "./types";

export function generateDiagnosticReport(
  result: ScanResult,
  policy: DiagnosticPolicy,
): string {
  const lines: string[] = [
    "# Spekta Diagnostics",
    "",
    `Target: ${result.target}`,
    `Scanned: ${result.scannedCount}`,
    `Violations: ${result.violations.length}`,
    `Errors: ${result.errors.length}`,
    "",
    "## Policy",
    `- Read token limit: ${policy.readTokenLimit}`,
    `- Compact threshold: ${policy.compactThreshold}`,
    "",
    "## Violations",
  ];

  if (result.violations.length === 0) {
    lines.push("No files exceed the read token limit.");
  } else {
    const sortedViolations = [...result.violations].sort((a, b) =>
      a.path.localeCompare(b.path),
    );

    for (const v of sortedViolations) {
      lines.push("");
      lines.push(`### ${v.path}`);
      lines.push(`- Raw tokens: ${v.rawTokens}`);
      lines.push(`- Final tokens: ${v.finalTokens}`);
      lines.push(`- Excess tokens: ${v.excessTokens}`);
      lines.push(`- Compacted: ${v.isCompacted}`);
      if (v.compactionWarning) {
        lines.push(`- Compaction warning: ${v.compactionWarning}`);
      }
      lines.push(`- Action: ${v.action}`);
    }
  }

  if (result.errors.length > 0) {
    lines.push("");
    lines.push("## Errors");

    const sortedErrors = [...result.errors].sort((a, b) =>
      a.path.localeCompare(b.path),
    );

    for (const err of sortedErrors) {
      lines.push("");
      lines.push(`### ${err.path}`);
      lines.push(`- Error: ${err.error}`);
      if (err.action) {
        lines.push(`- Action: ${err.action}`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}
