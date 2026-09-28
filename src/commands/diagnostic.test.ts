import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { runDiagnostic } from "./diagnostic";
import * as fileAnalyzer from "../utils/file-analyzer";

describe("runDiagnostic", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalExitCode: typeof process.exitCode;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "spekta-diag-cmd-"));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    await fs.remove(tempDir);
    vi.restoreAllMocks();
  });

  it("sets exit code 2 when multiple target arguments are passed", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runDiagnostic(["target1", "target2"]);

    expect(process.exitCode).toBe(2);
    stdoutSpy.mockRestore();
  });

  it("sets exit code 2 when target violates workspace security boundaries", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runDiagnostic(["../outside"]);

    expect(process.exitCode).toBe(2);
    stdoutSpy.mockRestore();
  });

  it("completes clean scan with exit code 0 and writes report", async () => {
    await fs.writeFile("file.ts", "export const ok = 1;");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runDiagnostic([], {
      outputDir: path.join(tempDir, "diagnostic-reports"),
    });

    expect(process.exitCode).toBe(0);
    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Diagnostic completed");
    expect(output).toContain("Violations: 0");
    stdoutSpy.mockRestore();
  });

  it("writes a scan-start acknowledgment before the completion summary", async () => {
    await fs.writeFile("file.ts", "export const ok = 1;");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runDiagnostic([], {
      outputDir: path.join(tempDir, "diagnostic-reports"),
    });

    const calls = stdoutSpy.mock.calls.map((c) => String(c[0]));
    const startIndex = calls.findIndex((line) => line.includes("Scanning ."));
    const completedIndex = calls.findIndex((line) =>
      line.includes("Diagnostic completed"),
    );

    expect(startIndex).toBeGreaterThanOrEqual(0);
    expect(completedIndex).toBeGreaterThan(startIndex);
    stdoutSpy.mockRestore();
  });

  it("writes reports to an explicitly supplied output directory", async () => {
    await fs.writeFile("file.ts", "export const ok = 1;");
    const reportDir = path.join(tempDir, "diagnostic-reports");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runDiagnostic([], { outputDir: reportDir });

    expect(process.exitCode).toBe(0);
    expect(await fs.pathExists(reportDir)).toBe(true);

    const reportFiles = await fs.readdir(reportDir);
    expect(reportFiles).toHaveLength(1);
    expect(reportFiles[0]).toMatch(/^\d{12}(?:-\d+)?\.md$/);

    expect(
      await fs.pathExists(path.join(tempDir, "spekta", "docs", "diagnostics")),
    ).toBe(false);

    stdoutSpy.mockRestore();
  });

  it("completes scan with violations and sets exit code 1", async () => {
    await fs.writeFile("large.ts", "token ".repeat(2500));

    vi.spyOn(fileAnalyzer, "analyzeFile").mockResolvedValue({
      path: "large.ts",
      content: "",
      totalLines: 1,
      rawTokens: 2500,
      finalTokens: 2000,
      isCompacted: true,
      exceedsLimit: true,
      excessTokens: 1000,
    });

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const reportDir = path.join(tempDir, "diagnostic-reports");

    await runDiagnostic(["large.ts"], {
      outputDir: reportDir,
    });

    expect(process.exitCode).toBe(1);
    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Violations: 1");

    const reportFiles = await fs.readdir(reportDir);
    const reportContent = await fs.readFile(
      path.join(reportDir, reportFiles[0]),
      "utf-8",
    );
    expect(reportContent).toContain("Status: Violation");
    expect(reportContent).toContain("Action: refactoring required");

    stdoutSpy.mockRestore();
  });

  it("exits with 0 when scan contains only optimization opportunities", async () => {
    await fs.writeFile("opt.ts", "export const value = 1;");

    vi.spyOn(fileAnalyzer, "analyzeFile").mockResolvedValue({
      path: "opt.ts",
      content: "",
      totalLines: 1,
      rawTokens: 400,
      finalTokens: 1200,
      isCompacted: false,
      exceedsLimit: true,
      excessTokens: 200,
    });

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const reportDir = path.join(tempDir, "diagnostic-reports");

    await runDiagnostic(["opt.ts"], {
      outputDir: reportDir,
    });

    expect(process.exitCode).toBe(0);
    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Violations: 0");

    const reportFiles = await fs.readdir(reportDir);
    const reportContent = await fs.readFile(
      path.join(reportDir, reportFiles[0]),
      "utf-8",
    );
    expect(reportContent).toContain("Status: Optimization opportunity");
    expect(reportContent).toContain("Action: optimization recommended");

    stdoutSpy.mockRestore();
  });

  it("exits with 0 and reports optimization opportunity for compacted file within limit", async () => {
    await fs.writeFile("compacted-opt.ts", "export const value = 1;");

    vi.spyOn(fileAnalyzer, "analyzeFile").mockResolvedValue({
      path: "compacted-opt.ts",
      content: "",
      totalLines: 1,
      rawTokens: 1500,
      finalTokens: 800,
      isCompacted: true,
      exceedsLimit: false,
      excessTokens: 0,
    });

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const reportDir = path.join(tempDir, "diagnostic-reports");

    await runDiagnostic(["compacted-opt.ts"], {
      outputDir: reportDir,
    });

    expect(process.exitCode).toBe(0);
    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Violations: 0");

    const reportFiles = await fs.readdir(reportDir);
    const reportContent = await fs.readFile(
      path.join(reportDir, reportFiles[0]),
      "utf-8",
    );
    expect(reportContent).toContain("Status: Optimization opportunity");
    expect(reportContent).toContain("Action: optimization recommended");
    expect(reportContent).toContain("- Compacted: true");
    expect(reportContent).toContain("- Excess tokens: 0");

    stdoutSpy.mockRestore();
  });

  it("exits with 1 when scan contains analysis incomplete findings", async () => {
    await fs.writeFile("incomplete.ts", "export const data = 1;");

    vi.spyOn(fileAnalyzer, "analyzeFile").mockResolvedValue({
      path: "incomplete.ts",
      content: "",
      totalLines: 1,
      rawTokens: 2500,
      finalTokens: 2500,
      isCompacted: false,
      exceedsLimit: true,
      excessTokens: 1500,
      compactionWarning: "Custom compaction failure",
    });

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const reportDir = path.join(tempDir, "diagnostic-reports");

    await runDiagnostic(["incomplete.ts"], {
      outputDir: reportDir,
    });

    expect(process.exitCode).toBe(1);
    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Violations: 0");

    const reportFiles = await fs.readdir(reportDir);
    const reportContent = await fs.readFile(
      path.join(reportDir, reportFiles[0]),
      "utf-8",
    );
    expect(reportContent).toContain("Status: Analysis incomplete");
    expect(reportContent).toContain(
      "Compaction warning: Custom compaction failure",
    );

    stdoutSpy.mockRestore();
  });

  it("exits with 0 when scan contains both optimization opportunity and healthy files", async () => {
    await fs.writeFile("opt.ts", "export const opt = 1;");
    await fs.writeFile("healthy.ts", "export const healthy = 1;");

    vi.spyOn(fileAnalyzer, "analyzeFile").mockImplementation((filePath) =>
      Promise.resolve(
        filePath.endsWith("opt.ts")
          ? {
              path: filePath,
              content: "",
              totalLines: 1,
              rawTokens: 400,
              finalTokens: 1200,
              isCompacted: false,
              exceedsLimit: true,
              excessTokens: 200,
            }
          : {
              path: filePath,
              content: "",
              totalLines: 1,
              rawTokens: 100,
              finalTokens: 100,
              isCompacted: false,
              exceedsLimit: false,
              excessTokens: 0,
            },
      ),
    );

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runDiagnostic([], {
      outputDir: path.join(tempDir, "diagnostic-reports"),
    });

    expect(process.exitCode).toBe(0);
    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Violations: 0");
    stdoutSpy.mockRestore();
  });

  it("exits with 1 when scan contains optimization opportunity plus a violation", async () => {
    await fs.writeFile("opt.ts", "export const opt = 1;");
    await fs.writeFile("violation.ts", "export const violation = 1;");

    vi.spyOn(fileAnalyzer, "analyzeFile").mockImplementation((filePath) =>
      Promise.resolve(
        filePath.endsWith("opt.ts")
          ? {
              path: filePath,
              content: "",
              totalLines: 1,
              rawTokens: 400,
              finalTokens: 1200,
              isCompacted: false,
              exceedsLimit: true,
              excessTokens: 200,
            }
          : {
              path: filePath,
              content: "",
              totalLines: 1,
              rawTokens: 2500,
              finalTokens: 2000,
              isCompacted: true,
              exceedsLimit: true,
              excessTokens: 1000,
            },
      ),
    );

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runDiagnostic([], {
      outputDir: path.join(tempDir, "diagnostic-reports"),
    });

    expect(process.exitCode).toBe(1);
    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Violations: 1");
    stdoutSpy.mockRestore();
  });

  it("exits with 1 when scan contains optimization opportunity plus analysis incomplete", async () => {
    await fs.writeFile("opt.ts", "export const opt = 1;");
    await fs.writeFile("incomplete.ts", "export const incomplete = 1;");

    vi.spyOn(fileAnalyzer, "analyzeFile").mockImplementation((filePath) =>
      Promise.resolve(
        filePath.endsWith("opt.ts")
          ? {
              path: filePath,
              content: "",
              totalLines: 1,
              rawTokens: 400,
              finalTokens: 1200,
              isCompacted: false,
              exceedsLimit: true,
              excessTokens: 200,
            }
          : {
              path: filePath,
              content: "",
              totalLines: 1,
              rawTokens: 2500,
              finalTokens: 2500,
              isCompacted: false,
              exceedsLimit: true,
              excessTokens: 1500,
            },
      ),
    );

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runDiagnostic([], {
      outputDir: path.join(tempDir, "diagnostic-reports"),
    });

    expect(process.exitCode).toBe(1);
    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Violations: 0");
    stdoutSpy.mockRestore();
  });

  it("exits with 1 when file analysis throws an access error during scan", async () => {
    await fs.writeFile("inaccessible.ts", "export const locked = 1;");

    vi.spyOn(fileAnalyzer, "analyzeFile").mockRejectedValue(
      new Error("EACCES: permission denied"),
    );

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runDiagnostic(["inaccessible.ts"], {
      outputDir: path.join(tempDir, "diagnostic-reports"),
    });

    expect(process.exitCode).toBe(1);
    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Errors: 1");
    stdoutSpy.mockRestore();
  });

  it("writes a per-file progress line for each scanned file before the summary", async () => {
    await fs.writeFile("one.ts", "export const a = 1;");
    await fs.writeFile("two.ts", "export const b = 2;");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runDiagnostic([], {
      outputDir: path.join(tempDir, "diagnostic-reports"),
    });

    const calls = stdoutSpy.mock.calls.map((c) => String(c[0]));
    const progressLines = calls.filter(
      (line) => line.includes("Scanning 1/2") || line.includes("Scanning 2/2"),
    );
    const completedIndex = calls.findIndex((line) =>
      line.includes("Diagnostic completed"),
    );

    expect(progressLines.length).toBe(2);
    expect(completedIndex).toBeGreaterThan(-1);
    stdoutSpy.mockRestore();
  });
});
