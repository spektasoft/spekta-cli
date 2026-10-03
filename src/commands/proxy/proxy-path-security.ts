import fs from "fs-extra";
import path from "path";

import { RESTRICTED_FILES } from "../../utils/security";
import type { WorkspaceContext } from "../../utils/workspace";

export type { WorkspaceContext } from "../../utils/workspace";

function workspaceRoot(context?: WorkspaceContext): string {
  return path.resolve(context?.root ?? process.cwd());
}

function isWindowsAbsolutePath(argument: string): boolean {
  return (
    path.win32.isAbsolute(argument) ||
    /^\\\\[^\\]+\\[^\\]+/.test(argument) ||
    /^[A-Za-z]:[\\/]/.test(argument)
  );
}

function isPathLikeArgument(argument: string): boolean {
  return (
    argument === "." ||
    argument === ".." ||
    RESTRICTED_FILES.includes(argument) ||
    argument.startsWith("./") ||
    argument.startsWith("../") ||
    argument.startsWith("~/") ||
    argument.startsWith("/") ||
    argument.includes("/") ||
    argument.includes("\\") ||
    isWindowsAbsolutePath(argument) ||
    !argument.startsWith("-")
  );
}

function isInsideProjectLexically(targetPath: string, root: string): boolean {
  const absolutePath = path.resolve(root, targetPath);
  const relativePath = path.relative(root, absolutePath);

  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

function isInsideProjectCanonical(targetPath: string, root: string): boolean {
  const projectRoot = fs.realpathSync(root);
  const absolutePath = path.resolve(root, targetPath);

  if (fs.existsSync(absolutePath)) {
    const realPath = fs.realpathSync(absolutePath);
    const relativePath = path.relative(projectRoot, realPath);

    return (
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath)
    );
  }

  let currentPath = path.dirname(absolutePath);

  while (
    currentPath !== path.parse(currentPath).root &&
    !fs.existsSync(currentPath)
  ) {
    currentPath = path.dirname(currentPath);
  }

  const realAncestor = fs.realpathSync(currentPath);
  const relativeAncestor = path.relative(projectRoot, realAncestor);

  return (
    relativeAncestor !== ".." &&
    !relativeAncestor.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativeAncestor)
  );
}

function targetsRestrictedFile(targetPath: string, root: string): boolean {
  const absolutePath = path.resolve(root, targetPath);
  const segments = absolutePath.split(/[\\/]+/).filter(Boolean);

  return segments.some((segment) => RESTRICTED_FILES.includes(segment));
}

function getPathArguments(args: string[]): string[] {
  const pathArguments: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (
      argument === "-C" ||
      argument === "--git-dir" ||
      argument === "--work-tree"
    ) {
      const value = args[index + 1];

      if (value !== undefined) {
        pathArguments.push(value);
      }

      continue;
    }

    const equalsIndex = argument.indexOf("=");

    if (equalsIndex !== -1 && argument.startsWith("-")) {
      const value = argument.slice(equalsIndex + 1);

      if (value !== "") {
        pathArguments.push(value);
      }
    }

    if (isPathLikeArgument(argument)) {
      pathArguments.push(argument);
    }
  }

  return [...new Set(pathArguments)];
}

export function validateProxyPathOperand(
  operand: string,
  context?: WorkspaceContext,
): void {
  const root = workspaceRoot(context);
  if (
    operand === "" ||
    Array.from(operand).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    throw new Error("Execution refused: invalid Git path operand.");
  }
  if (isWindowsAbsolutePath(operand) || path.isAbsolute(operand)) {
    throw new Error(
      "Access Denied: Git path resolves outside the project directory.",
    );
  }
  if (/[\\:*?[\]]/.test(operand) || operand.startsWith("~/")) {
    throw new Error("Execution refused: unsupported Git path syntax.");
  }

  validateCommandArguments([`./${operand}`], context);
  let ancestor = path.resolve(root, operand);
  while (true) {
    try {
      fs.lstatSync(ancestor);
      break;
    } catch (error: unknown) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      if (code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  // lstat sees dangling links that existsSync deliberately hides.
  fs.realpathSync(ancestor);
  validateCommandArguments(
    [`./${path.relative(root, ancestor) || "."}`],
    context,
  );
}

export function validateCommandArguments(
  args: string[],
  context?: WorkspaceContext,
): void {
  const root = workspaceRoot(context);
  const pathArguments = getPathArguments(args);

  for (const argument of args) {
    if (targetsRestrictedFile(argument, root)) {
      throw new Error(
        `Access Denied: command argument '${argument}' targets a restricted file or path.`,
      );
    }
  }

  for (const argument of pathArguments) {
    if (isWindowsAbsolutePath(argument) || path.isAbsolute(argument)) {
      throw new Error(
        `Access Denied: command argument '${argument}' resolves outside the project directory.`,
      );
    }

    if (!isInsideProjectLexically(argument, root)) {
      throw new Error(
        `Access Denied: command argument '${argument}' resolves outside the project directory.`,
      );
    }

    if (!isInsideProjectCanonical(argument, root)) {
      throw new Error(
        `Access Denied: command argument '${argument}' resolves outside the project directory.`,
      );
    }

    const absolutePath = path.resolve(root, argument);
    if (
      fs.existsSync(absolutePath) &&
      targetsRestrictedFile(fs.realpathSync(absolutePath), root)
    ) {
      throw new Error(
        `Access Denied: command argument '${argument}' targets a restricted file or path.`,
      );
    }
  }
}
