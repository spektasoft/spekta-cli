import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { saveDiagnosticReport, formatReportFileName } from "./storage";

describe("saveDiagnosticReport", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "spekta-diag-storage-"));
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it("formats base filename using minute-based timestamp format", () => {
    const fixedDate = new Date(2026, 8, 15, 20, 26);
    expect(formatReportFileName(fixedDate)).toBe("202609152026.md");
  });

  it("creates directory and writes file if it does not exist", async () => {
    const baseDir = path.join(tempDir, "diagnostics");
    const fixedDate = new Date(2026, 8, 15, 20, 26);
    const content = "# Spekta Diagnostics";

    const savedPath = await saveDiagnosticReport(content, baseDir, fixedDate);

    expect(savedPath).toBe(path.join(baseDir, "202609152026.md"));
    expect(await fs.pathExists(savedPath)).toBe(true);
    expect(await fs.readFile(savedPath, "utf-8")).toBe(content);
  });

  it("appends lowest numeric suffix starting at -1 on collision without overwriting", async () => {
    const baseDir = path.join(tempDir, "diagnostics");
    const fixedDate = new Date(2026, 8, 15, 20, 26);

    const firstPath = await saveDiagnosticReport(
      "First report",
      baseDir,
      fixedDate,
    );
    const secondPath = await saveDiagnosticReport(
      "Second report",
      baseDir,
      fixedDate,
    );
    const thirdPath = await saveDiagnosticReport(
      "Third report",
      baseDir,
      fixedDate,
    );

    expect(firstPath).toBe(path.join(baseDir, "202609152026.md"));
    expect(secondPath).toBe(path.join(baseDir, "202609152026-1.md"));
    expect(thirdPath).toBe(path.join(baseDir, "202609152026-2.md"));

    expect(await fs.readFile(firstPath, "utf-8")).toBe("First report");
    expect(await fs.readFile(secondPath, "utf-8")).toBe("Second report");
    expect(await fs.readFile(thirdPath, "utf-8")).toBe("Third report");
  });
});
