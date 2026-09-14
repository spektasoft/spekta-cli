import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import { isRtkAvailable, runRtkProxy } from "./proxy";

describe("truncateOutput", () => {
  it("leaves output unchanged below the token limit", async () => {
    const { truncateOutput } = await import("./proxy");
    const result = truncateOutput("one\ntwo\nthree");

    expect(result.truncated).toBe(false);
    expect(result.content).toBe("one\ntwo\nthree");
  });

  it("collapses the middle of oversized output", async () => {
    const { truncateOutput } = await import("./proxy");
    const output = Array.from(
      { length: 1500 },
      (_, index) => `line-${index}`,
    ).join("\n");

    const result = truncateOutput(output);

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("lines collapsed: exceeds 1000 tokens");
    expect(result.content).toContain("line-0");
    expect(result.content).toContain("line-1499");
  });
});

describe("formatProxyOutput", () => {
  it("formats a successful result without badges", async () => {
    const { formatProxyOutput } = await import("./proxy");

    expect(formatProxyOutput("git status", "clean")).toBe(
      "### spekta git status\n\n```\nclean\n```",
    );
  });

  it("adds the truncation badge only when truncated", async () => {
    const { formatProxyOutput } = await import("./proxy");

    expect(formatProxyOutput("git log", "tail", { truncated: true })).toContain(
      "[OUTPUT TRUNCATED: >1000 TOKENS]",
    );
  });

  it("adds the failure badge only for non-zero exits", async () => {
    const { formatProxyOutput } = await import("./proxy");

    expect(formatProxyOutput("git test", "failed", { exitCode: 2 })).toContain(
      "[FAILED: Exit 2]",
    );
  });
});

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
    mockExeca
      .mockResolvedValueOnce({
        stdout: "rtk 1.0.0",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as never)
      .mockResolvedValueOnce({
        stdout: "clean",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as never);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runRtkProxy("git", ["status"]);

    expect(mockExeca).toHaveBeenLastCalledWith(
      "rtk",
      ["git", "status"],
      expect.objectContaining({
        reject: false,
      }),
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining("### spekta git"));
  });

  it("does not throw on a non-zero RTK command exit", async () => {
    mockExeca
      .mockResolvedValueOnce({
        stdout: "rtk 1.0.0",
        stderr: "",
        exitCode: 0,
        failed: false,
      } as never)
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "command failed",
        exitCode: 2,
        failed: true,
      } as never);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(runRtkProxy("git", ["status"])).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("[FAILED: Exit 2]"),
    );
  });

  it("prints an advisory instead of executing missing RTK", async () => {
    mockExeca.mockRejectedValueOnce(new Error("not found"));

    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runRtkProxy("git", ["status"]);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("rtk unavailable"),
    );
  });
});
