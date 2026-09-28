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
    expect(report).toContain("Status: Violation");
    expect(report).toContain("Final tokens: 1400");
    expect(report).toContain("Raw tokens: 1400");
    expect(report).toContain("Excess tokens: 400");
    expect(report).toContain("Compacted: false");
    expect(report).toContain("Action: refactoring required");
    expect(report).toContain("Compaction warning: Node limit reached");
  });

  it("renders optimization opportunity with status and recommended action", () => {
    const result: ScanResult = {
      target: "src",
      scannedCount: 1,
      findings: [
        {
          path: "src/opt.ts",
          status: "Optimization opportunity",
          rawTokens: 600,
          finalTokens: 1100,
          excessTokens: 100,
          isCompacted: false,
        },
      ],
      errors: [],
    };

    const report = generateDiagnosticReport(result, policy);

    expect(report).toContain("### src/opt.ts");
    expect(report).toContain("- Status: Optimization opportunity");
    expect(report).toContain("- Action: optimization recommended");
    expect(report).toContain("- Excess tokens: 100");
  });

  it("renders analysis incomplete preserving custom compaction warning", () => {
    const result: ScanResult = {
      target: "src",
      scannedCount: 1,
      findings: [
        {
          path: "src/incomplete.ts",
          status: "Analysis incomplete",
          rawTokens: 2000,
          finalTokens: 2000,
          excessTokens: 1000,
          isCompacted: false,
          compactionWarning: "AST parser crashed on syntax",
        },
      ],
      errors: [],
    };

    const report = generateDiagnosticReport(result, policy);

    expect(report).toContain("### src/incomplete.ts");
    expect(report).toContain("- Status: Analysis incomplete");
    expect(report).toContain(
      "- Compaction warning: AST parser crashed on syntax",
    );
    expect(report).not.toContain("- Action:");
  });

  it("renders analysis incomplete with fallback compaction warning when none provided", () => {
    const result: ScanResult = {
      target: "src",
      scannedCount: 1,
      findings: [
        {
          path: "src/incomplete-fallback.ts",
          status: "Analysis incomplete",
          rawTokens: 1500,
          finalTokens: 1500,
          excessTokens: 500,
          isCompacted: false,
        },
      ],
      errors: [],
    };

    const report = generateDiagnosticReport(result, policy);

    expect(report).toContain("### src/incomplete-fallback.ts");
    expect(report).toContain("- Status: Analysis incomplete");
    expect(report).toContain(
      "- Compaction warning: Compaction could not be completed; manual review required.",
    );
  });

  it("omits healthy findings and reports clean scan message", () => {
    const result: ScanResult = {
      target: "src",
      scannedCount: 2,
      findings: [
        {
          path: "src/healthy.ts",
          status: "Healthy",
          rawTokens: 300,
          finalTokens: 300,
          excessTokens: 0,
          isCompacted: false,
        },
      ],
      errors: [],
    };

    const report = generateDiagnosticReport(result, policy);

    expect(report).toContain("No files exceed the read token limit.");
    expect(report).not.toContain("### src/healthy.ts");
    expect(report).not.toContain("Status: Healthy");
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
