import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import path from "path";
import os from "os";
import { input } from "@inquirer/prompts";
import { runDiagnosticInteractive } from "./diagnostic-interactive";

vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
}));

// Mock the internal runDiagnostic to avoid real dependency side effects during test
vi.mock("./diagnostic", () => ({
  runDiagnostic: vi.fn().mockImplementation(async (args) => {
    process.stdout.write(`Diagnostic completed\nTarget: ${args[0]}`);
    process.exitCode = 0;
  }),
}));

describe("runDiagnosticInteractive", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalExitCode: number | undefined;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "spekta-diag-interactive-"),
    );
    process.chdir(tempDir);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    await fs.remove(tempDir);
    vi.restoreAllMocks();
  });

  it("prompts for target and executes diagnostic on an explicit file target", async () => {
    await fs.writeFile("index.ts", "export const value = 42;");
    vi.mocked(input).mockResolvedValueOnce("index.ts");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runDiagnosticInteractive();

    expect(process.exitCode).toBe(0);
    const output = stdoutSpy.mock.calls.map((call) => call[0]).join("");
    expect(output).toContain("Diagnostic completed");
    expect(output).toContain("Target: index.ts");
    stdoutSpy.mockRestore();
  });

  it("prompts for target and executes diagnostic on an explicit directory target", async () => {
    await fs.mkdirp("src");
    await fs.writeFile(
      path.join("src", "module.ts"),
      "export const ok = true;",
    );
    vi.mocked(input).mockResolvedValueOnce("src");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runDiagnosticInteractive();

    expect(process.exitCode).toBe(0);
    const output = stdoutSpy.mock.calls.map((call) => call[0]).join("");
    expect(output).toContain("Diagnostic completed");
    expect(output).toContain("Target: src");
    stdoutSpy.mockRestore();
  });

  it("resolves an empty input string to current directory dot", async () => {
    await fs.writeFile("root.ts", "export const root = true;");
    vi.mocked(input).mockResolvedValueOnce("");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runDiagnosticInteractive();

    expect(process.exitCode).toBe(0);
    const output = stdoutSpy.mock.calls.map((call) => call[0]).join("");
    expect(output).toContain("Diagnostic completed");
    expect(output).toContain("Target: .");
    stdoutSpy.mockRestore();
  });

  it.each(["q", "c", "back", "cancel", " CANCEL ", "Q"])(
    "exits cleanly without scan or report when user enters '%s'",
    async (cancelKeyword) => {
      vi.mocked(input).mockResolvedValueOnce(cancelKeyword);
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

      await runDiagnosticInteractive();

      expect(process.exitCode).toBeUndefined();
      expect(stdoutSpy).not.toHaveBeenCalled();
      stdoutSpy.mockRestore();
    },
  );

  it("exits cleanly without failure when Inquirer prompt is aborted", async () => {
    const exitPromptError = new Error("User force closed the prompt");
    exitPromptError.name = "ExitPromptError";
    vi.mocked(input).mockRejectedValueOnce(exitPromptError);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await runDiagnosticInteractive();

    expect(process.exitCode).toBeUndefined();
    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });
});
