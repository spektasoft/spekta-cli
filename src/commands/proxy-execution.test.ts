import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import { executeRtkCommand, isRtkAvailable } from "./proxy-execution";

describe("executeRtkCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes RTK once with the requested command", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      stdout: "clean",
      stderr: "",
      exitCode: 0,
    } as never);

    await expect(executeRtkCommand("git", ["status"])).resolves.toEqual({
      available: true,
      stdout: "clean",
      stderr: "",
      exitCode: 0,
    });

    expect(execa).toHaveBeenCalledTimes(1);
    expect(execa).toHaveBeenCalledWith(
      "rtk",
      ["git", "status"],
      expect.objectContaining({
        reject: false,
        env: expect.objectContaining({
          NO_COLOR: "1",
          TERM: "dumb",
        }),
      }),
    );
  });

  it("reports a missing RTK executable separately from command failure", async () => {
    vi.mocked(execa).mockRejectedValueOnce(
      Object.assign(new Error("not found"), { code: "ENOENT" }),
    );

    await expect(executeRtkCommand("git", ["status"])).resolves.toEqual({
      available: false,
    });
  });

  it("preserves non-zero RTK exits as available command results", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      stdout: "",
      stderr: "failed",
      exitCode: 2,
    } as never);

    await expect(executeRtkCommand("git", ["test"])).resolves.toEqual({
      available: true,
      stdout: "",
      stderr: "failed",
      exitCode: 2,
    });
  });

  it("retains the compatibility availability check", async () => {
    vi.mocked(execa).mockResolvedValueOnce({} as never);

    await expect(isRtkAvailable()).resolves.toBe(true);
  });
});
