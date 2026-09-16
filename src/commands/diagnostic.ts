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
  } catch (error: any) {
    Logger.error(`Execution failed: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  try {
    const scanResult = await scanTarget(rawTarget);
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
      violationCount: scanResult.violations.length,
      errorCount: scanResult.errors.length,
      reportPath: relativeReportPath,
    });

    process.stdout.write(terminalSummary + "\n");

    if (scanResult.violations.length > 0 || scanResult.errors.length > 0) {
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }
  } catch (error: any) {
    Logger.error(`Execution failed: ${error.message}`);
    process.exitCode = 2;
  }
}
