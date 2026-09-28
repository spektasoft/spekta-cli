import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { execa } from "execa";
import fs from "fs-extra";
import path from "path";
import os from "os";
import * as fileAnalyzer from "../../utils/file-analyzer";

vi.mock("../../utils/file-analyzer", async () => {
  const actual = await vi.importActual<
    typeof import("../../utils/file-analyzer")
  >("../../utils/file-analyzer");
  return {
    ...actual,
    analyzeFile: vi.fn(actual.analyzeFile),
  };
});

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    createReadStream: vi.fn(actual.createReadStream),
  };
});

import { classifyAnalysis, scanTarget } from "./scanner";

describe("classifyAnalysis", () => {
  const analysis = {
    path: "example.ts",
    content: "",
    totalLines: 10,
    rawTokens: 0,
    finalTokens: 0,
    isCompacted: false,
    exceedsLimit: false,
    excessTokens: 0,
  };

  it("classifies a small file over the read limit as an optimization opportunity", () => {
    const finding = classifyAnalysis(
      {
        ...analysis,
        rawTokens: 400,
        finalTokens: 1200,
        exceedsLimit: true,
        excessTokens: 200,
      },
      500,
      1000,
    );

    expect(finding).toMatchObject({
      status: "Optimization opportunity",
      excessTokens: 200,
      action: "optimization recommended",
    });
  });

  it("classifies a compacted file within the read limit as an optimization opportunity", () => {
    const finding = classifyAnalysis(
      {
        ...analysis,
        rawTokens: 1200,
        finalTokens: 900,
        isCompacted: true,
      },
      500,
      1000,
    );

    expect(finding).toMatchObject({
      status: "Optimization opportunity",
      rawTokens: 1200,
      finalTokens: 900,
      excessTokens: 0,
      isCompacted: true,
      action: "optimization recommended",
    });
  });

  it("classifies a successfully compacted file still over the limit as a violation", () => {
    const finding = classifyAnalysis(
      {
        ...analysis,
        rawTokens: 1200,
        finalTokens: 1100,
        isCompacted: true,
        exceedsLimit: true,
        excessTokens: 100,
      },
      500,
      1000,
    );

    expect(finding).toMatchObject({
      status: "Violation",
      excessTokens: 100,
      action: "refactoring required",
    });
  });

  it("classifies an un-compacted large file as analysis incomplete", () => {
    const finding = classifyAnalysis(
      {
        ...analysis,
        rawTokens: 1200,
        finalTokens: 1200,
        compactionWarning: "Node limit reached",
        exceedsLimit: true,
        excessTokens: 200,
      },
      500,
      1000,
    );

    expect(finding).toMatchObject({
      status: "Analysis incomplete",
      excessTokens: 200,
      compactionWarning: "Node limit reached",
    });
  });

  it("uses the fallback warning when compaction is incomplete without a warning", () => {
    const finding = classifyAnalysis(
      {
        ...analysis,
        rawTokens: 1200,
        finalTokens: 1200,
        exceedsLimit: true,
        excessTokens: 200,
      },
      500,
      1000,
    );

    expect(finding).toMatchObject({
      status: "Analysis incomplete",
      compactionWarning:
        "Compaction could not be completed; manual review required.",
    });
  });
});

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
    expect(result.findings.length).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it("handles directory with zero eligible files gracefully", async () => {
    await fs.ensureDir("empty-dir");

    const result = await scanTarget("empty-dir");

    expect(result.scannedCount).toBe(0);
    expect(result.findings.length).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it("classifies a compacted file that remains above the read token limit as violation", async () => {
    const hugeContent = "word ".repeat(2000);
    await fs.writeFile("large.txt", hugeContent);
    const file = path.resolve("large.txt");

    vi.spyOn(fileAnalyzer, "analyzeFile").mockResolvedValue({
      path: file,
      content: "compacted content",
      totalLines: 1,
      rawTokens: 2000,
      finalTokens: 1200,
      isCompacted: true,
      exceedsLimit: true,
      excessTokens: 200,
    });

    const result = await scanTarget("large.txt");

    expect(result.scannedCount).toBe(1);
    expect(result.findings.length).toBe(1);
    expect(result.findings[0].path).toBe("large.txt");
    expect(result.findings[0].status).toBe("Violation");
    expect(result.findings[0].action).toBe("refactoring required");
    expect(result.findings[0].finalTokens).toBeGreaterThan(1000);
    expect(result.findings[0].excessTokens).toBeGreaterThan(0);
  });

  it("skips binary and ignored files during directory scan without error", async () => {
    await fs.writeFile("valid.ts", "export const x = 1;");
    await fs.writeFile("binary.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(".spektaignore", "ignored.ts\n");
    await fs.writeFile("ignored.ts", "export const y = 2;");

    vi.spyOn(fileAnalyzer, "analyzeFile").mockImplementation((filePath) =>
      Promise.resolve({
        path: filePath,
        content: "",
        totalLines: 1,
        rawTokens: 50,
        finalTokens: 50,
        isCompacted: false,
        exceedsLimit: false,
        excessTokens: 0,
      }),
    );

    const result = await scanTarget(".");

    expect(result.scannedCount).toBe(1);
    expect(result.findings.length).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it("isolates file read errors and continues scanning other files", async () => {
    await fs.writeFile("good.ts", "export const a = 1;");
    await fs.writeFile("unreadable.ts", "export const b = 2;");

    interface MockedFsModule {
      createReadStream: MockInstance<(...args: unknown[]) => unknown>;
    }

    const mockedFs = (await import("fs")) as unknown as MockedFsModule;
    const originalCreateReadStream =
      mockedFs.createReadStream.getMockImplementation();

    mockedFs.createReadStream.mockImplementation(
      (filePath: unknown, ...args: unknown[]) => {
        if (String(filePath).includes("unreadable.ts")) {
          const error = Object.assign(new Error("EACCES: permission denied"), {
            code: "EACCES",
          });
          throw error;
        }

        if (!originalCreateReadStream) {
          throw new Error("Original createReadStream implementation not found");
        }

        return originalCreateReadStream(filePath, ...args);
      },
    );

    vi.spyOn(fileAnalyzer, "analyzeFile").mockImplementation((filePath) => {
      if (filePath.endsWith("unreadable.ts")) {
        return Promise.reject(
          Object.assign(new Error("EACCES: permission denied"), {
            code: "EACCES",
          }),
        );
      }

      return Promise.resolve({
        path: filePath,
        content: "",
        totalLines: 1,
        rawTokens: 50,
        finalTokens: 50,
        isCompacted: false,
        exceedsLimit: false,
        excessTokens: 0,
      });
    });

    const result = await scanTarget(".");

    expect(result.scannedCount).toBe(2);
    expect(result.findings.length).toBe(0);
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
    await fs.writeFile(
      path.join(tempDir, ".gitignore"),
      "dist\nnode_modules\n",
    );
    await fs.mkdirp(path.join(tempDir, "node_modules", "some-pkg"));
    await fs.writeFile(
      path.join(tempDir, "node_modules", "some-pkg", "index.js"),
      "module.exports = {};",
    );
    await fs.writeFile(path.join(tempDir, "app.ts"), "export const ok = 1;");

    const result = await scanTarget(".");

    expect(result.scannedCount).toBe(1);
    expect(result.findings.some((v) => v.path.includes("node_modules"))).toBe(
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
    expect(result.findings.some((v) => v.path.includes(".git"))).toBe(false);
    expect(result.errors.some((e) => e.path.includes(".git"))).toBe(false);
  });

  it("excludes gitignored directories like vendor in a git repo even if spekta patterns contain negation rules", async () => {
    await execa("git", ["init"], { cwd: tempDir });
    await execa("git", ["config", "user.email", "test@example.com"], {
      cwd: tempDir,
    });
    await execa("git", ["config", "user.name", "Test User"], { cwd: tempDir });

    await fs.writeFile(
      path.join(tempDir, ".gitignore"),
      "vendor/\nnode_modules/\n",
    );

    const vendorDir = path.join(tempDir, "vendor", "composer-pkg");
    await fs.mkdirp(vendorDir);
    await fs.writeFile(
      path.join(vendorDir, "autoload.php"),
      "<?php echo 'vendor';",
    );

    const srcDir = path.join(tempDir, "src");
    await fs.mkdirp(srcDir);
    await fs.writeFile(
      path.join(srcDir, "index.ts"),
      "export const ok = true;",
    );

    await execa("git", ["add", ".gitignore", "src/index.ts"], { cwd: tempDir });

    vi.spyOn(fileAnalyzer, "analyzeFile").mockImplementation((filePath) =>
      Promise.resolve({
        path: filePath,
        content: "",
        totalLines: 1,
        rawTokens: 50,
        finalTokens: 50,
        isCompacted: false,
        exceedsLimit: false,
        excessTokens: 0,
      }),
    );

    const result = await scanTarget(".");

    expect(result.scannedCount).toBe(1);
    expect(result.findings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("prunes ignored directories in non-git directory using root gitignore and spekta rules without hardcoded set", async () => {
    await fs.writeFile(
      path.join(tempDir, ".gitignore"),
      "custom_cache/\nthird_party/\n",
    );

    const cacheDir = path.join(tempDir, "custom_cache");
    await fs.mkdirp(cacheDir);
    await fs.writeFile(
      path.join(cacheDir, "cached.ts"),
      "export const cached = true;",
    );

    const thirdPartyDir = path.join(tempDir, "third_party");
    await fs.mkdirp(thirdPartyDir);
    await fs.writeFile(
      path.join(thirdPartyDir, "dep.ts"),
      "export const dep = true;",
    );

    const srcDir = path.join(tempDir, "src");
    await fs.mkdirp(srcDir);
    await fs.writeFile(path.join(srcDir, "app.ts"), "export const app = true;");

    vi.spyOn(fileAnalyzer, "analyzeFile").mockImplementation((filePath) =>
      Promise.resolve({
        path: filePath,
        content: "",
        totalLines: 1,
        rawTokens: 50,
        finalTokens: 50,
        isCompacted: false,
        exceedsLimit: false,
        excessTokens: 0,
      }),
    );

    const result = await scanTarget(".");

    expect(result.scannedCount).toBe(1);
    expect(result.findings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
