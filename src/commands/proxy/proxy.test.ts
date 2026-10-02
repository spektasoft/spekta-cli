import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import { isRtkAvailable, runRtkProxy } from "./proxy";

describe("RTK execution", () => {
  const mockExeca = vi.mocked(execa);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("executes RTK and formats successful output", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "clean",
      stderr: "",
      exitCode: 0,
      failed: false,
    } as never);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runRtkProxy("ls", []);

    expect(mockExeca).toHaveBeenCalledTimes(1);
    expect(mockExeca).toHaveBeenCalledWith(
      "rtk",
      ["ls"],
      expect.objectContaining({
        reject: false,
      }),
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining("### spekta ls"));
  });

  it("does not throw on a non-zero RTK command exit", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "",
      stderr: "command failed",
      exitCode: 2,
      failed: true,
    } as never);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(runRtkProxy("ls", [])).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("[FAILED: Exit 2]"),
    );
    expect(mockExeca).toHaveBeenCalledTimes(1);
    expect(mockExeca).toHaveBeenCalledWith("rtk", ["ls"], expect.any(Object));
  });

  it("prints an advisory instead of executing missing RTK", async () => {
    mockExeca.mockRejectedValueOnce(
      Object.assign(new Error("not found"), { code: "ENOENT" }),
    );

    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runRtkProxy("ls", []);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("rtk unavailable"),
    );
    expect(mockExeca).toHaveBeenCalledTimes(1);
    expect(mockExeca).toHaveBeenCalledWith("rtk", ["ls"], expect.any(Object));
  });
});
