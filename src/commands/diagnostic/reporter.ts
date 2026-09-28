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
    `Violations: ${
      result.findings.filter((finding) => finding.status === "Violation").length
    }`,
    `Errors: ${result.errors.length}`,
    "",
    "## Policy",
    `- Read token limit: ${policy.readTokenLimit}`,
    `- Compact threshold: ${policy.compactThreshold}`,
    "",
    "## Violations",
  ];

  const reportableFindings = result.findings.filter(
    (finding) => finding.status !== "Healthy",
  );

  if (reportableFindings.length === 0) {
    lines.push("No files exceed the read token limit.");
  } else {
    const sortedFindings = [...reportableFindings].sort((a, b) =>
      a.path.localeCompare(b.path),
    );

    for (const f of sortedFindings) {
      lines.push("");
      lines.push(`### ${f.path}`);
      lines.push(`- Status: ${f.status}`);
      lines.push(`- Raw tokens: ${f.rawTokens}`);
      lines.push(`- Final tokens: ${f.finalTokens}`);
      lines.push(`- Excess tokens: ${f.excessTokens}`);
      lines.push(`- Compacted: ${f.isCompacted}`);

      const warning =
        f.compactionWarning ||
        (f.status === "Analysis incomplete"
          ? "Compaction could not be completed; manual review required."
          : undefined);

      if (warning) {
        lines.push(`- Compaction warning: ${warning}`);
      }

      let action = f.action;
      if (f.status === "Optimization opportunity") {
        action = action ?? "optimization recommended";
      } else if (f.status === "Violation") {
        action = action ?? "refactoring required";
      }

      if (action) {
        lines.push(`- Action: ${action}`);
      }
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
