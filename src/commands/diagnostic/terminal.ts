import { DiagnosticSummary } from "./types";

export function formatTerminalSummary(summary: DiagnosticSummary): string {
  return [
    `Diagnostic ${summary.status.toLowerCase()}`,
    `Target: ${summary.target}`,
    `Scanned: ${summary.scannedCount}`,
    `Violations: ${summary.violationCount}`,
    `Optimization opportunities: ${summary.optimizationOpportunityCount}`,
    `Analysis incomplete: ${summary.analysisIncompleteCount}`,
    `Errors: ${summary.errorCount}`,
    `Report: ${summary.reportPath}`,
  ].join("\n");
}
