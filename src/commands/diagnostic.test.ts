import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { runDiagnostic } from "./diagnostic";

describe("runDiagnostic", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalExitCode: number | undefined;

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

    await runDiagnostic([]);

    expect(process.exitCode).toBe(0);
    expect(stdoutSpy).toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Diagnostic completed");
    expect(output).toContain("Violations: 0");
    stdoutSpy.mockRestore();
  });

  it("completes scan with violations and sets exit code 1", async () => {
    await fs.writeFile("large.ts", "token ".repeat(2500));
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runDiagnostic(["large.ts"]);

    expect(process.exitCode).toBe(1);
    const output = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("Violations: 1");
    stdoutSpy.mockRestore();
  });
});
