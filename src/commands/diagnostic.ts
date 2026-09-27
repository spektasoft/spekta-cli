import path from "path";
import { getCompactThreshold, getReadTokenLimit } from "../core/config";
import { Logger } from "../utils/logger";
import { validatePathAccess } from "../utils/security";
import { generateDiagnosticReport } from "./diagnostic/reporter";
import { scanTarget } from "./diagnostic/scanner";
import { saveDiagnosticReport } from "./diagnostic/storage";
import { formatTerminalSummary } from "./diagnostic/terminal";

export interface DiagnosticOptions {
  outputDir?: string;
}

export async function runDiagnostic(
  args?: string[],
  options?: DiagnosticOptions,
): Promise<void> {
  const safeArgs = args || [];

  if (safeArgs.length > 1) {
    Logger.error("Usage: spekta diagnostic [file|directory]");
    process.exitCode = 2;
    return;
  }

  const rawTarget = safeArgs[0] || ".";

  try {
    await validatePathAccess(rawTarget);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    Logger.error(`Execution failed: ${message}`);
    process.exitCode = 2;
    return;
  }

  process.stdout.write(`Scanning ${rawTarget}...\n`);

  try {
    const scanResult = await scanTarget(
      rawTarget,
      (current, total, displayPath) => {
        process.stdout.write(`Scanning ${current}/${total}: ${displayPath}\n`);
      },
    );
    const policy = {
      readTokenLimit: getReadTokenLimit(),
      compactThreshold: getCompactThreshold(),
    };

    const reportContent = generateDiagnosticReport(scanResult, policy);
    const savedPath = await saveDiagnosticReport(
      reportContent,
      options?.outputDir,
    );

    const relativeReportPath = path
      .relative(process.cwd(), savedPath)
      .split(path.sep)
      .join("/");

    const terminalSummary = formatTerminalSummary({
      status: "Completed",
      target: scanResult.target,
      scannedCount: scanResult.scannedCount,
      violationCount: scanResult.findings.filter(
        (finding) => finding.status === "Violation",
      ).length,
      errorCount: scanResult.errors.length,
      reportPath: relativeReportPath,
    });

    process.stdout.write(terminalSummary + "\n");

    if (
      scanResult.findings.some((finding) => finding.status === "Violation") ||
      scanResult.errors.length > 0
    ) {
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    Logger.error(`Execution failed: ${message}`);
    process.exitCode = 2;
  }
}
