import { DiagnosticPolicy, ScanResult } from "./types";

export function generateDiagnosticReport(
  result: ScanResult,
  policy: DiagnosticPolicy,
): string {
  const violations = result.findings
    .filter((finding) => finding.status === "Violation")
    .sort((a, b) => a.path.localeCompare(b.path));

  const optimizationOpportunities = result.findings
    .filter((finding) => finding.status === "Optimization opportunity")
    .sort((a, b) => a.path.localeCompare(b.path));

  const analysisIncomplete = result.findings
    .filter((finding) => finding.status === "Analysis incomplete")
    .sort((a, b) => a.path.localeCompare(b.path));

  const lines: string[] = [
    "# Spekta Diagnostics",
    "",
    `Target: ${result.target}`,
    `Scanned: ${result.scannedCount}`,
    `Violations: ${violations.length}`,
    `Optimization opportunities: ${optimizationOpportunities.length}`,
    `Analysis incomplete: ${analysisIncomplete.length}`,
    `Errors: ${result.errors.length}`,
    "",
    "## Policy",
    `- Read token limit: ${policy.readTokenLimit}`,
    `- Compact threshold: ${policy.compactThreshold}`,
    "",
    "## Violations",
  ];

  if (violations.length === 0) {
    lines.push("No files exceed the read token limit.");
  } else {
    for (const f of violations) {
      lines.push("");
      lines.push(`### ${f.path}`);
      lines.push(`- Status: ${f.status}`);
      lines.push(`- Raw tokens: ${f.rawTokens}`);
      lines.push(`- Final tokens: ${f.finalTokens}`);
      lines.push(`- Excess tokens: ${f.excessTokens}`);
      lines.push(`- Compacted: ${f.isCompacted}`);

      if (f.compactionWarning) {
        lines.push(`- Compaction warning: ${f.compactionWarning}`);
      }

      const action = f.action ?? "refactoring required";
      lines.push(`- Action: ${action}`);
    }
  }

  if (optimizationOpportunities.length > 0) {
    lines.push("");
    lines.push("## Optimization Opportunities");

    for (const f of optimizationOpportunities) {
      lines.push("");
      lines.push(`### ${f.path}`);
      lines.push(`- Status: ${f.status}`);
      lines.push(`- Raw tokens: ${f.rawTokens}`);
      lines.push(`- Final tokens: ${f.finalTokens}`);
      lines.push(`- Excess tokens: ${f.excessTokens}`);
      lines.push(`- Compacted: ${f.isCompacted}`);

      if (f.compactionWarning) {
        lines.push(`- Compaction warning: ${f.compactionWarning}`);
      }

      const action = f.action ?? "optimization recommended";
      lines.push(`- Action: ${action}`);
    }
  }

  if (analysisIncomplete.length > 0) {
    lines.push("");
    lines.push("## Analysis Incomplete");

    for (const f of analysisIncomplete) {
      lines.push("");
      lines.push(`### ${f.path}`);
      lines.push(`- Status: ${f.status}`);
      lines.push(`- Raw tokens: ${f.rawTokens}`);
      lines.push(`- Final tokens: ${f.finalTokens}`);
      lines.push(`- Excess tokens: ${f.excessTokens}`);
      lines.push(`- Compacted: ${f.isCompacted}`);

      const warning =
        f.compactionWarning ||
        "Compaction could not be completed; manual review required.";
      lines.push(`- Compaction warning: ${warning}`);

      if (f.action) {
        lines.push(`- Action: ${f.action}`);
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
