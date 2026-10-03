import fs from "fs-extra";
import path from "path";
import { validateCommandArguments } from "./proxy-path-security";
import type { WorkspaceContext } from "../../utils/workspace";

function containsControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function validateFindRoot(root: string, context?: WorkspaceContext): void {
  if (root === "") {
    throw new Error("Execution refused: invalid find directory operand.");
  }

  // Only actual roots enter filesystem-path validation.
  // Preserve the existing lexical, canonical, cwd, and restricted-path checks.
  validateCommandArguments([root], context);

  const segments = root.split("/");
  const supportedSegments =
    root === "." ||
    segments.every(
      (segment, index) =>
        segment !== "" && segment !== ".." && (segment !== "." || index === 0),
    );

  if (
    /[\\:*?[\]]/.test(root) ||
    root.startsWith("~/") ||
    ["!", "(", ")"].includes(root) ||
    !supportedSegments
  ) {
    throw new Error("Execution refused: unsupported find root syntax.");
  }

  let isDirectory = false;
  try {
    isDirectory = fs
      .statSync(path.resolve(context?.root ?? process.cwd(), root))
      .isDirectory();
  } catch {
    // Missing, dangling, or inaccessible roots fail closed.
  }

  if (!isDirectory) {
    throw new Error(
      `Execution refused: '${root}' must be an existing workspace directory.`,
    );
  }
}

export function validateFindProxyRequest(
  args: string[],
  context?: WorkspaceContext,
): void {
  if (args.some(containsControlCharacters)) {
    throw new Error("Execution refused: invalid find argument.");
  }

  // A leading predicate uses the default root. A root beginning with a dash
  // must be supplied with a ./ prefix, for example ./-directory.
  const hasExplicitRoot = args.length > 0 && !args[0].startsWith("-");
  const root = hasExplicitRoot ? args[0] : ".";

  validateFindRoot(root, context);

  let index = hasExplicitRoot ? 1 : 0;
  let seenType = false;
  let seenName = false;

  while (index < args.length) {
    const token = args[index];

    if (token === "-type") {
      if (seenType) {
        throw new Error("Execution refused: duplicate find -type predicate.");
      }

      const value = args[index + 1];
      if (value !== "f" && value !== "d") {
        throw new Error(
          "Execution refused: find -type requires exactly 'f' or 'd'.",
        );
      }

      seenType = true;
      index += 2;
      continue;
    }

    if (token === "-name") {
      if (seenName) {
        throw new Error("Execution refused: duplicate find -name predicate.");
      }

      const value = args[index + 1];
      if (value === undefined || value === "") {
        throw new Error(
          "Execution refused: find -name requires a nonempty pattern.",
        );
      }

      // Values such as *.ts, ../outside, and -exec are literal patterns.
      // Never send this value to filesystem-path validation.
      seenName = true;
      index += 2;
      continue;
    }

    if (token === "-print") {
      if (index !== args.length - 1) {
        throw new Error(
          "Execution refused: find supports only one terminal -print action.",
        );
      }

      return;
    }

    throw new Error(`Execution refused: unsupported find token '${token}'.`);
  }
}
