import fs from "fs-extra";
import path from "path";

import { RESTRICTED_FILES } from "../utils/security";

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
    isWindowsAbsolutePath(argument)
  );
}

function isInsideProjectLexically(targetPath: string): boolean {
  const absolutePath = path.resolve(process.cwd(), targetPath);
  const relativePath = path.relative(process.cwd(), absolutePath);

  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function isInsideProjectCanonical(targetPath: string): boolean {
  const projectRoot = fs.realpathSync(process.cwd());
  const absolutePath = path.resolve(process.cwd(), targetPath);

  if (fs.existsSync(absolutePath)) {
    const realPath = fs.realpathSync(absolutePath);
    const relativePath = path.relative(projectRoot, realPath);

    return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
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
    !relativeAncestor.startsWith("..") && !path.isAbsolute(relativeAncestor)
  );
}

function targetsRestrictedFile(targetPath: string): boolean {
  const absolutePath = path.resolve(process.cwd(), targetPath);
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

export function validateCommandArguments(args: string[]): void {
  const pathArguments = getPathArguments(args);

  for (const argument of args) {
    if (targetsRestrictedFile(argument)) {
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

    if (!isInsideProjectLexically(argument)) {
      throw new Error(
        `Access Denied: command argument '${argument}' resolves outside the project directory.`,
      );
    }

    if (!isInsideProjectCanonical(argument)) {
      throw new Error(
        `Access Denied: command argument '${argument}' resolves outside the project directory.`,
      );
    }
  }
}
