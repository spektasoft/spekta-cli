export type FindingStatus = "Healthy" | "Violation" | "Analysis error";

export interface ViolationFinding {
  path: string;
  rawTokens: number;
  finalTokens: number;
  excessTokens: number;
  isCompacted: boolean;
  compactionWarning?: string;
  action: "refactoring required";
}

export interface ErrorFinding {
  path: string;
  error: string;
  action?: "investigate file access";
}

export interface ScanResult {
  target: string;
  scannedCount: number;
  violations: ViolationFinding[];
  errors: ErrorFinding[];
}

export interface DiagnosticPolicy {
  readTokenLimit: number;
  compactThreshold: number;
}

export interface DiagnosticSummary {
  status: "Completed" | "Failed";
  target: string;
  scannedCount: number;
  violationCount: number;
  errorCount: number;
  reportPath: string;
}
