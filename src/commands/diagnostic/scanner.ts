import { execa } from "execa";
import fs from "fs-extra";
import ignore from "ignore";
import isBinaryPath from "is-binary-path";
import path from "path";
import { getIgnorePatterns } from "../../core/config";
import { analyzeFile } from "../../utils/file-analyzer";
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

async function collectFilesFromGit(
  resolvedTarget: string,
  projectRoot: string,
  ignorePatterns: string[],
): Promise<string[] | null> {
  try {
    const targetRel = path.relative(projectRoot, resolvedTarget);
    const args = [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ];
    if (targetRel !== "" && !targetRel.startsWith("..")) {
      args.push("--", targetRel);
    }

    const { stdout } = await execa("git", args, { cwd: projectRoot });
    if (!stdout) {
      return [];
    }

    const auditPatterns = ignorePatterns.filter(
      (pattern) => !pattern.startsWith("!"),
    );
    const ig = auditPatterns.length > 0 ? ignore().add(auditPatterns) : null;

    const rawPaths = stdout.split("\0").filter(Boolean);
    const eligibleFiles: string[] = [];

    for (const rawRelPath of rawPaths) {
      const normalized = rawRelPath.split(path.sep).join("/");
      if (ig && ig.ignores(normalized)) {
        continue;
      }
      const fullPath = path.resolve(projectRoot, rawRelPath);
      if (isEligibleFile(fullPath)) {
        eligibleFiles.push(fullPath);
      }
    }

    return eligibleFiles;
  } catch {
    return null;
  }
}

async function collectFilesFallback(
  entryPath: string,
  projectRoot: string,
  ig: ReturnType<typeof ignore> | null,
): Promise<string[]> {
  const baseName = path.basename(entryPath);
  if (baseName === ".git") {
    return [];
  }

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
    if (!isEligibleFile(entryPath) || (rel !== "" && ig && ig.ignores(rel))) {
      return [];
    }
    return [entryPath];
  }

  if (currentStats.isDirectory()) {
    const rel = normalizeRelative(entryPath);
    if (rel !== "" && ig && ig.ignores(rel)) {
      return [];
    }

    const entries = await fs.readdir(entryPath);
    const collected: string[] = [];

    for (const entry of entries) {
      const subPath = path.join(entryPath, entry);
      const subFiles = await collectFilesFallback(subPath, projectRoot, ig);
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
  const ignorePatterns = await getIgnorePatterns();

  let files: string[];
  const gitFiles = await collectFilesFromGit(
    resolvedTarget,
    projectRoot,
    ignorePatterns,
  );

  if (gitFiles !== null) {
    files = gitFiles;
  } else {
    const auditPatterns = ignorePatterns.filter(
      (pattern) => !pattern.startsWith("!"),
    );
    const rootGitignorePath = path.join(projectRoot, ".gitignore");
    if (await fs.pathExists(rootGitignorePath)) {
      try {
        const gitignoreContent = await fs.readFile(rootGitignorePath, "utf-8");
        const lines = gitignoreContent
          .split("\n")
          .map((line) => line.trim())
          .filter(
            (line) =>
              line !== "" && !line.startsWith("#") && !line.startsWith("!"),
          );
        auditPatterns.push(...lines);
      } catch {
        // Fall back to configured patterns if reading .gitignore fails
      }
    }

    const ig = auditPatterns.length > 0 ? ignore().add(auditPatterns) : null;
    files = await collectFilesFallback(resolvedTarget, projectRoot, ig);
  }

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
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const errorCode =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? (error as { code: string }).code
          : undefined;

      const isAccess =
        errorCode === "EACCES" ||
        errorCode === "EPERM" ||
        errorCode === "ENOENT" ||
        /access|permission/i.test(message);

      errors.push({
        path: displayPath,
        error: message,
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
