import fs from "fs-extra";
import isBinaryPath from "is-binary-path";
import path from "path";
import { getReadTokenLimit } from "../../core/config";
import { analyzeFile } from "../../utils/file-analyzer";
import { isPathIgnored } from "../../utils/path-ignore";
import { RESTRICTED_FILES } from "../../utils/security";
import { ErrorFinding, ScanResult, ViolationFinding } from "./types";

function normalizeRelative(filePath: string): string {
  const rel = path.relative(process.cwd(), path.resolve(filePath));
  return rel.split(path.sep).join("/");
}

function isEligibleFile(filePath: string): boolean {
  const baseName = path.basename(filePath);
  if (RESTRICTED_FILES.includes(baseName)) {
    return false;
  }
  if (isBinaryPath(filePath)) {
    return false;
  }
  return true;
}

async function collectFiles(
  entryPath: string,
  projectRoot: string,
): Promise<string[]> {
  const stats = await fs.lstat(entryPath);

  if (stats.isSymbolicLink()) {
    try {
      const real = await fs.realpath(entryPath);
      const rel = path.relative(projectRoot, real);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        return [];
      }
    } catch {
      return [];
    }
  }

  const currentStats = await fs.stat(entryPath);

  if (currentStats.isFile()) {
    const rel = normalizeRelative(entryPath);
    if (
      !isEligibleFile(entryPath) ||
      (rel !== "" && (await isPathIgnored(entryPath)))
    ) {
      return [];
    }
    return [entryPath];
  }

  if (currentStats.isDirectory()) {
    const rel = normalizeRelative(entryPath);
    if (rel !== "" && (await isPathIgnored(entryPath))) {
      return [];
    }

    const entries = await fs.readdir(entryPath);
    const collected: string[] = [];

    for (const entry of entries) {
      const subPath = path.join(entryPath, entry);
      const subFiles = await collectFiles(subPath, projectRoot);
      collected.push(...subFiles);
    }
    return collected;
  }

  return [];
}

export async function scanTarget(
  target: string,
  onProgress?: (current: number, total: number, displayPath: string) => void,
): Promise<ScanResult> {
  const projectRoot = await fs.realpath(process.cwd());
  const resolvedTarget = path.resolve(process.cwd(), target);

  const files = await collectFiles(resolvedTarget, projectRoot);
  const readTokenLimit = getReadTokenLimit();

  const violations: ViolationFinding[] = [];
  const errors: ErrorFinding[] = [];

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const displayPath = normalizeRelative(file);
    onProgress?.(index + 1, files.length, displayPath);
    try {
      const analysis = await analyzeFile(file);
      if (analysis.exceedsLimit) {
        violations.push({
          path: displayPath,
          rawTokens: analysis.rawTokens,
          finalTokens: analysis.finalTokens,
          excessTokens: analysis.excessTokens,
          isCompacted: analysis.isCompacted,
          compactionWarning: analysis.compactionWarning,
          action: "refactoring required",
        });
      }
    } catch (error: any) {
      const isAccess =
        error.code === "EACCES" ||
        error.code === "EPERM" ||
        error.code === "ENOENT" ||
        /access|permission/i.test(error.message || "");

      errors.push({
        path: displayPath,
        error: error.message || String(error),
        action: isAccess ? "investigate file access" : undefined,
      });
    }
  }

  return {
    target: normalizeRelative(target) || ".",
    scannedCount: files.length,
    violations,
    errors,
  };
}
