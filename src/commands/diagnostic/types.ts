export type FindingStatus =
  "Healthy" | "Optimization opportunity" | "Violation" | "Analysis incomplete";

export type FindingAction = "optimization recommended" | "refactoring required";

export interface DiagnosticFinding {
  path: string;
  status: FindingStatus;
  rawTokens: number;
  finalTokens: number;
  excessTokens: number;
  isCompacted: boolean;
  compactionWarning?: string;
  action?: FindingAction;
}

export interface ErrorFinding {
  path: string;
  error: string;
  action?: "investigate file access";
}

export interface ScanResult {
  target: string;
  scannedCount: number;
  findings: DiagnosticFinding[];
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
  optimizationOpportunityCount: number;
  analysisIncompleteCount: number;
  errorCount: number;
  reportPath: string;
}
