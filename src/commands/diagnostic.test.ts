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

    await runDiagnostic(["large.ts"], {
      outputDir: path.join(tempDir, "diagnostic-reports"),
    });

    expect(process.exitCode).toBe(1);
    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Violations: 1");
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
