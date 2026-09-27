import { describe, expect, it } from "vitest";
import { generateDiagnosticReport } from "./reporter";
import { DiagnosticPolicy, ScanResult } from "./types";

describe("generateDiagnosticReport", () => {
  const policy: DiagnosticPolicy = {
    readTokenLimit: 1000,
    compactThreshold: 500,
  };

  it("renders a clean scan with zero violations and omits error section", () => {
    const result: ScanResult = {
      target: ".",
      scannedCount: 15,
      findings: [],
      errors: [],
    };

    const report = generateDiagnosticReport(result, policy);

    expect(report).toContain("# Spekta Diagnostics");
    expect(report).toContain("Target: .");
    expect(report).toContain("Scanned: 15");
    expect(report).toContain("Violations: 0");
    expect(report).toContain("Errors: 0");
    expect(report).toContain("## Policy");
    expect(report).toContain("- Read token limit: 1000");
    expect(report).toContain("- Compact threshold: 500");
    expect(report).toContain("## Violations");
    expect(report).toContain("No files exceed the read token limit.");
    expect(report).not.toContain("## Errors");
  });

  it("renders sorted violations with final tokens, excess tokens, and refactoring required", () => {
    const result: ScanResult = {
      target: "src",
      scannedCount: 2,
      findings: [
        {
          path: "src/b.ts",
          status: "Violation",
          rawTokens: 1500,
          finalTokens: 1200,
          excessTokens: 200,
          isCompacted: true,
          compactionWarning: "Node limit reached",
          action: "refactoring required",
        },
        {
          path: "src/a.ts",
          status: "Violation",
          rawTokens: 1400,
          finalTokens: 1400,
          excessTokens: 400,
          isCompacted: false,
          action: "refactoring required",
        },
      ],
      errors: [],
    };

    const report = generateDiagnosticReport(result, policy);

    expect(report.indexOf("src/a.ts")).toBeLessThan(report.indexOf("src/b.ts"));
    expect(report).toContain("Final tokens: 1400");
    expect(report).toContain("Raw tokens: 1400");
    expect(report).toContain("Excess tokens: 400");
    expect(report).toContain("Compacted: false");
    expect(report).toContain("Action: refactoring required");
    expect(report).toContain("Compaction warning: Node limit reached");
  });

  it("includes Errors section when errors exist, sorted independently", () => {
    const result: ScanResult = {
      target: ".",
      scannedCount: 3,
      findings: [],
      errors: [
        {
          path: "src/z.ts",
          error: "EACCES: permission denied",
          action: "investigate file access",
        },
        {
          path: "src/m.ts",
          error: "Unexpected token in file",
        },
      ],
    };

    const report = generateDiagnosticReport(result, policy);

    expect(report).toContain("## Errors");
    expect(report.indexOf("src/m.ts")).toBeLessThan(report.indexOf("src/z.ts"));
    expect(report).toContain("Error: EACCES: permission denied");
    expect(report).toContain("Action: investigate file access");
  });
});
