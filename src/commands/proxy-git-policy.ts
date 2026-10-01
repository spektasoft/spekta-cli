import fs from "fs-extra";
import path from "path";
import { validateProxyPathOperand } from "./proxy-path-security";

const STATUS_FLAGS = new Set([
  "-s",
  "--short",
  "-b",
  "--branch",
  "--porcelain",
  "--porcelain=v1",
  "--porcelain=v2",
  "--untracked-files=no",
  "--untracked-files=normal",
  "--untracked-files=all",
]);
const HISTORY_FLAGS = new Set([
  "--oneline",
  "-p",
  "--patch",
  "--no-patch",
  "--stat",
  "--name-only",
  "--name-status",
]);
const LOG_FLAGS = new Set([
  "--graph",
  "--all",
  "--decorate",
  "--decorate=short",
  "--decorate=full",
  "--decorate=no",
]);

function fail(message: string): never {
  throw new Error(`Execution refused: ${message}`);
}
function validInteger(value: string, positive: boolean): boolean {
  return (
    /^[0-9]+$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    (positive ? Number(value) > 0 : Number(value) >= 0)
  );
}
function validateRevision(revision: string): void {
  const match = /^([A-Za-z0-9_][A-Za-z0-9._/-]*)([~^].*)?$/.exec(revision);
  if (!match) fail(`unsupported Git revision '${revision}'.`);
  const base = match[1];
  const suffix = match[2] ?? "";
  const components = base.split("/");
  if (
    base.includes("..") ||
    components.some(
      (component) =>
        component === "" ||
        component.startsWith(".") ||
        component.endsWith(".") ||
        component.endsWith(".lock"),
    )
  ) {
    fail(`unsupported Git revision '${revision}'.`);
  }
  if (!/^(?:[~^][0-9]*)*$/.test(suffix))
    fail(`unsupported Git revision '${revision}'.`);
  for (const count of suffix.split(/[~^]/).filter(Boolean)) {
    if (!validInteger(count, false))
      fail(`unsupported Git revision '${revision}'.`);
  }
}
function validateLogRevision(operand: string): void {
  if (!operand.includes("..")) return validateRevision(operand);
  const match = /^(.*?)\.{2,3}(.*?)$/.exec(operand);
  if (!match || (!match[1] && !match[2]))
    fail(`unsupported Git revision '${operand}'.`);
  if (match[1]) validateRevision(match[1]);
  if (match[2]) validateRevision(match[2]);
}
function findRepositoryRoot(): string {
  let directory = path.resolve(process.cwd());
  while (true) {
    let marker: ReturnType<typeof fs.lstatSync> | undefined;
    try {
      marker = fs.lstatSync(path.join(directory, ".git"));
    } catch (error: unknown) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      if (code !== "ENOENT") throw error;
    }
    if (marker) {
      if (
        marker.isSymbolicLink() ||
        (!marker.isFile() && !marker.isDirectory())
      ) {
        fail("unsupported Git repository marker.");
      }
      return directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory)
      fail("cannot establish Git repository root for blob selector.");
    directory = parent;
  }
}
function validateBlobSelector(selector: string): void {
  const colon = selector.indexOf(":");
  const revision = selector.slice(0, colon);
  const blobPath = selector.slice(colon + 1);
  validateRevision(revision);
  if (
    !blobPath ||
    blobPath.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    fail("invalid Git blob path.");
  }
  // First reject Git path syntax independently of root/cwd translation.
  if (
    path.posix.isAbsolute(blobPath) ||
    path.win32.isAbsolute(blobPath) ||
    Array.from(blobPath).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    /[\\:*?[\]]/.test(blobPath) ||
    blobPath.startsWith("~/")
  ) {
    fail("unsupported Git blob path syntax.");
  }
  const target = path.resolve(findRepositoryRoot(), blobPath);
  validateProxyPathOperand(path.relative(process.cwd(), target) || ".");
}

export function validateGitProxyRequest(args: string[]): void {
  const subcommand = args[0];
  if (!["status", "log", "show"].includes(subcommand)) {
    fail(`unsupported Git subcommand '${subcommand ?? ""}'.`);
  }
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) {
    if (process.env[key] !== undefined)
      fail(`unsupported Git workspace override '${key}'.`);
  }
  const allowed = subcommand === "status" ? STATUS_FLAGS : HISTORY_FLAGS;
  let index = 1;
  let countSeen = false;
  while (
    index < args.length &&
    args[index] !== "--" &&
    args[index].startsWith("-")
  ) {
    const option = args[index];
    if (
      subcommand === "log" &&
      (option === "-n" || option.startsWith("--max-count="))
    ) {
      const value =
        option === "-n" ? args[index + 1] : option.slice("--max-count=".length);
      if (countSeen || value === undefined || !validInteger(value, true)) {
        fail("invalid or repeated Git log count option.");
      }
      countSeen = true;
      index += option === "-n" ? 2 : 1;
      continue;
    }
    if (
      !allowed.has(option) &&
      !(subcommand === "log" && LOG_FLAGS.has(option))
    ) {
      fail(`unsupported option '${option}'.`);
    }
    index += 1;
  }
  const separator = args.indexOf("--", index);
  const revisions = args.slice(
    index,
    separator === -1 ? args.length : separator,
  );
  const paths = separator === -1 ? [] : args.slice(separator + 1);
  if (paths.includes("--"))
    fail("multiple Git path separators are unsupported.");
  if (subcommand === "status" && revisions.length > 0) {
    fail("Git status paths require '--'.");
  }
  if (subcommand === "show" && revisions.length > 1) {
    fail("Git show supports at most one revision or blob selector.");
  }
  const blob =
    subcommand === "show" &&
    revisions.length === 1 &&
    revisions[0].includes(":");
  if (blob && paths.length > 0)
    fail("Git blob selector does not accept additional path operands.");
  for (const revision of revisions) {
    if (revision.startsWith("-")) fail(`unsupported option '${revision}'.`);
    if (subcommand === "log") validateLogRevision(revision);
    else if (blob) validateBlobSelector(revision);
    else validateRevision(revision);
  }
  validateProxyPathOperand(".");
  for (const operand of paths) validateProxyPathOperand(operand);
}
