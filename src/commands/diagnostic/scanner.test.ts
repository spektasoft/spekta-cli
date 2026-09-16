import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import fs from "fs-extra";
import path from "path";
import os from "os";

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    createReadStream: vi.fn(actual.createReadStream),
  };
});

import { scanTarget } from "./scanner";

describe("scanTarget", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "spekta-diag-scan-"));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.remove(tempDir);
    vi.restoreAllMocks();
  });

  it("scans single eligible file and classifies as healthy", async () => {
    await fs.writeFile("small.txt", "const a = 1;");

    const result = await scanTarget("small.txt");

    expect(result.scannedCount).toBe(1);
    expect(result.violations.length).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it("handles directory with zero eligible files gracefully", async () => {
    await fs.ensureDir("empty-dir");

    const result = await scanTarget("empty-dir");

    expect(result.scannedCount).toBe(0);
    expect(result.violations.length).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it("classifies file exceeding read token limit as violation", async () => {
    const hugeContent = "word ".repeat(2000);
    await fs.writeFile("large.txt", hugeContent);

    const result = await scanTarget("large.txt");

    expect(result.scannedCount).toBe(1);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].path).toBe("large.txt");
    expect(result.violations[0].action).toBe("refactoring required");
    expect(result.violations[0].finalTokens).toBeGreaterThan(1000);
    expect(result.violations[0].excessTokens).toBeGreaterThan(0);
  });

  it("skips binary and ignored files during directory scan without error", async () => {
    await fs.writeFile("valid.ts", "export const x = 1;");
    await fs.writeFile("binary.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(".spektaignore", "ignored.ts\n");
    await fs.writeFile("ignored.ts", "export const y = 2;");

    const result = await scanTarget(".");

    expect(result.scannedCount).toBe(1);
    expect(result.violations.length).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it("isolates file read errors and continues scanning other files", async () => {
    await fs.writeFile("good.ts", "export const a = 1;");
    await fs.writeFile("unreadable.ts", "export const b = 2;");

    const mockedFs = await import("fs");
    const originalCreateReadStream =
      mockedFs.createReadStream.getMockImplementation();

    mockedFs.createReadStream.mockImplementation(
      (filePath: any, ...args: any[]) => {
        if (filePath.toString().includes("unreadable.ts")) {
          const error: any = new Error("EACCES: permission denied");
          error.code = "EACCES";
          throw error;
        }

        return (originalCreateReadStream as any)(filePath, ...args);
      },
    );

    const result = await scanTarget(".");

    expect(result.scannedCount).toBe(2);
    expect(result.violations.length).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].path).toBe("unreadable.ts");
    expect(result.errors[0].action).toBe("investigate file access");
  });

  it("invokes onProgress once per scanned file with index, total, and path", async () => {
    await fs.writeFile("a.ts", "export const a = 1;");
    await fs.writeFile("b.ts", "export const b = 2;");

    const onProgress = vi.fn();

    const result = await scanTarget(".", onProgress);

    expect(result.scannedCount).toBe(2);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2, "a.ts");
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2, "b.ts");
  });

  it("excludes files under a node_modules directory from the scan result", async () => {
    await fs.mkdirp(path.join(tempDir, "node_modules", "some-pkg"));
    await fs.writeFile(
      path.join(tempDir, "node_modules", "some-pkg", "index.js"),
      "module.exports = {};",
    );
    await fs.writeFile(path.join(tempDir, "app.ts"), "export const ok = 1;");

    const result = await scanTarget(".");

    expect(result.scannedCount).toBe(1);
    expect(result.violations.some((v) => v.path.includes("node_modules"))).toBe(
      false,
    );
    expect(result.errors.some((e) => e.path.includes("node_modules"))).toBe(
      false,
    );
  });

  it("excludes files under a .git directory from the scan result", async () => {
    await fs.mkdirp(path.join(tempDir, ".git", "objects"));
    await fs.writeFile(
      path.join(tempDir, ".git", "objects", "abc123"),
      "binary-ish content",
    );
    await fs.writeFile(path.join(tempDir, "app.ts"), "export const ok = 1;");

    const result = await scanTarget(".");

    expect(result.scannedCount).toBe(1);
    expect(result.violations.some((v) => v.path.includes(".git"))).toBe(false);
    expect(result.errors.some((e) => e.path.includes(".git"))).toBe(false);
  });
});
