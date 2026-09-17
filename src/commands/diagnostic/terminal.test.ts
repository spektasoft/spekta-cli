import { describe, expect, it } from "vitest";
import { formatTerminalSummary } from "./terminal";
import { DiagnosticSummary } from "./types";

describe("formatTerminalSummary", () => {
  it("formats concise terminal summary without duplicating findings", () => {
    const summary: DiagnosticSummary = {
      status: "Completed",
      target: "src",
      scannedCount: 20,
      violationCount: 1,
      errorCount: 0,
      reportPath: "spekta/docs/diagnostics/202609152026.md",
    };

    const output = formatTerminalSummary(summary);

    expect(output).toContain("Diagnostic completed");
    expect(output).toContain("Target: src");
    expect(output).toContain("Scanned: 20");
    expect(output).toContain("Violations: 1");
    expect(output).toContain("Errors: 0");
    expect(output).toContain("Report: spekta/docs/diagnostics/202609152026.md");
  });
});
