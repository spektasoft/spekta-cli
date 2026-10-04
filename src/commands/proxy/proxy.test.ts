import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));
vi.mock("../../core/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../core/config")>()),
  getIgnorePatterns: vi.fn().mockResolvedValue([]),
}));

import fs from "fs-extra";
import os from "os";
import path from "path";
import { execa } from "execa";
import { isRtkAvailable, runRtkProxy } from "./proxy";
import { getTokenCount } from "../../utils/read-utils";

const workspaces: string[] = [];

function makeWorkspace(names: string[]): { root: string } {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "spekta-proxy-ls-")),
  );
  workspaces.push(root);
  for (const name of names) fs.writeFileSync(path.join(root, name), "x");
  return { root };
}

function mockRtkResult(result: {
  stdout: string;
  stderr: string;
  exitCode: number;
  failed: boolean;
}): void {
  vi.mocked(execa).mockImplementation(((file: string) => {
    if (file === "git") {
      throw Object.assign(new Error("not ignored"), { exitCode: 1 });
    }
    return result;
  }) as never);
}

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
    for (const root of workspaces.splice(0)) fs.removeSync(root);
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
      const names = [
        "a-first.txt",
        ...Array.from(
          { length: 600 },
          (_, index) => `entry-${String(index).padStart(4, "0")}.txt`,
        ),
        `${secret}.txt`,
        "z-last.txt",
      ];
      const workspace = makeWorkspace(names);
      mockRtkResult({
        stdout: `${names.join("\n")}\n`,
        stderr: "",
        exitCode: 0,
        failed: false,
      });

      await runRtkProxy("ls", [], workspace);

      const output = vi.mocked(console.log).mock.calls[0][0] as string;
      expect(output).toContain("### spekta ls");
      expect(output).toContain("a-first.txt");
      expect(output).toContain("z-last.txt");
      expect(output).toContain("lines collapsed");
      expect(output).not.toContain(secret);
      expect(getTokenCount(`${output}\n`)).toBeLessThanOrEqual(1000);
      expect(console.error).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(previous);
    },
  );

  it("omits denied entries from the listing", async () => {
    const workspace = makeWorkspace([".env", "visible.txt"]);
    mockRtkResult({
      stdout: ".env\nvisible.txt\n",
      stderr: "",
      exitCode: 0,
      failed: false,
    });

    await runRtkProxy("ls", [], workspace);

    const output = vi.mocked(console.log).mock.calls[0][0] as string;
    expect(output).toContain("visible.txt");
    expect(output).not.toContain(".env");
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "reports status 7 with empty output=%s",
    async (empty) => {
      const workspace = makeWorkspace([".env"]);
      mockRtkResult({
        stdout: empty ? "" : `.env\n${secret}\n`,
        stderr: empty ? "" : "USEFUL_STDERR",
        exitCode: 7,
        failed: true,
      });

      await expect(runRtkProxy("ls", [], workspace)).resolves.toBeUndefined();

      expect(console.log).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledTimes(1);
      const diagnostic = vi.mocked(console.error).mock.calls[0][0] as string;
      expect(diagnostic).toMatch(/status 7/i);
      expect(diagnostic).not.toContain(secret);
      expect(diagnostic).not.toContain("USEFUL_STDERR");
      expect(diagnostic).not.toContain(".env");
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
      expect(diagnostic).toContain("RTK listing failed");
      expect(diagnostic).not.toContain("USEFUL_START");
      expect(diagnostic).not.toContain("USEFUL_STDERR");
      expect(diagnostic).not.toContain("failure line");
      expect(diagnostic).not.toContain(secret);
      expect(getTokenCount(diagnostic)).toBeLessThanOrEqual(1000);
      expect(console.log).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    },
  );

  it("renders unusual names as one escaped entry each", async () => {
    const names = ["line\nbreak.txt", "tick```fence.txt", "tab\tname.txt"];
    const workspace = makeWorkspace(names);
    mockRtkResult({
      stdout:
        ["line\\nbreak.txt", "tick```fence.txt", "tab\\tname.txt"].join("\n") +
        "\n",
      stderr: "",
      exitCode: 0,
      failed: false,
    });

    await runRtkProxy("ls", [], workspace);

    const output = vi.mocked(console.log).mock.calls[0][0] as string;
    expect(output).toContain('"line\\nbreak.txt"');
    expect(output).toContain('"tick\\u0060\\u0060\\u0060fence.txt"');
    expect(output).toContain('"tab\\tname.txt"');
    expect(output).not.toContain("line\nbreak.txt");
  });
});
