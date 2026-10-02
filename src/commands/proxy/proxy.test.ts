import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import { isRtkAvailable, runRtkProxy } from "./proxy";
import { getTokenCount } from "../../utils/read-utils";

describe("RTK execution", () => {
  const mockExeca = vi.mocked(execa);
  let savedExitCode: typeof process.exitCode;
  const secret = "ghp_abcdefghijklmnopqrstuvwxyz";

  beforeEach(() => {
    vi.clearAllMocks();
    savedExitCode = process.exitCode;
    process.exitCode = undefined;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = savedExitCode;
  });

  it("reports RTK availability", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "rtk 1.0.0",
      stderr: "",
      exitCode: 0,
      failed: false,
    } as never);

    await expect(isRtkAvailable()).resolves.toBe(true);
  });

  it("returns false when RTK is unavailable", async () => {
    mockExeca.mockRejectedValueOnce(new Error("not found"));

    await expect(isRtkAvailable()).resolves.toBe(false);
  });

  it.each([undefined, 7])(
    "formats success without clearing prior status %s",
    async (previous) => {
      process.exitCode = previous;
      mockExeca.mockResolvedValueOnce({
        stdout: `USEFUL_START ${secret}\n${"listing line\n".repeat(3000)}USEFUL_END`,
        stderr: "",
        exitCode: 0,
        failed: false,
      } as never);

      await runRtkProxy("ls", []);

      const output = vi.mocked(console.log).mock.calls[0][0] as string;
      expect(output).toContain("### spekta ls");
      expect(output).toContain("USEFUL_START");
      expect(output).toContain("USEFUL_END");
      expect(output).toContain("lines collapsed");
      expect(output).not.toContain(secret);
      expect(console.error).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(previous);
    },
  );

  it.each([false, true])(
    "reports status 7 with empty output=%s",
    async (empty) => {
      mockExeca.mockResolvedValueOnce({
        stdout: empty
          ? ""
          : `USEFUL_START ${secret}\n${"listing line\n".repeat(3000)}USEFUL_END`,
        stderr: empty ? "" : "USEFUL_STDERR",
        exitCode: 7,
        failed: true,
      } as never);

      await expect(runRtkProxy("ls", [])).resolves.toBeUndefined();

      const output = vi.mocked(console.log).mock.calls[0][0] as string;
      expect(output).toContain("[FAILED: Exit 7]");
      expect(output).not.toContain(secret);
      if (!empty) {
        expect(output).toContain("USEFUL_START");
        expect(output).toContain("USEFUL_END");
        expect(output).toContain("USEFUL_STDERR");
        expect(output).toContain("lines collapsed");
      }
      expect(console.error).toHaveBeenCalledWith(
        expect.stringMatching(/status 7/i),
      );
      expect(process.exitCode).toBe(7);
    },
  );

  it("reports missing RTK on stderr with status 1", async () => {
    mockExeca.mockRejectedValueOnce(
      Object.assign(new Error("not found"), { code: "ENOENT" }),
    );

    await runRtkProxy("ls", []);

    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/rtk[\s\S]*not found/i),
    );
    expect(console.log).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it.each(["launch", "signal"])(
    "reports safe bounded %s diagnostics",
    async (mode) => {
      const failure = Object.assign(
        new Error(
          `USEFUL_START ${secret}\n${"failure line\n".repeat(3000)}USEFUL_STDERR`,
        ),
        {
          failed: true,
          ...(mode === "launch" ? { code: "EACCES" } : { signal: "SIGTERM" }),
        },
      );
      mockExeca.mockResolvedValueOnce(failure as never);
      await expect(runRtkProxy("ls", [])).resolves.toBeUndefined();
      const diagnostic = vi.mocked(console.error).mock.calls[0][0] as string;
      expect(diagnostic).toContain("USEFUL_START");
      expect(diagnostic).toContain("USEFUL_STDERR");
      expect(diagnostic).toContain("lines collapsed");
      expect(diagnostic).not.toContain(secret);
      expect(getTokenCount(diagnostic)).toBeLessThanOrEqual(1000);
      expect(console.log).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    },
  );
});
