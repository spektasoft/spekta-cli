import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { RESTRICTED_FILES, validateReadPathAccess } from "./utils/security";
import { isPathWithin, resolveWorkspace } from "./utils/workspace";

export interface BuildMetadata {
  version: string;
  sourceRevision: string;
  sourceState: "clean" | "modified" | "unknown";
}

declare const __SPEKTA_BUILD_METADATA__: BuildMetadata;

export const buildMetadata: BuildMetadata =
  typeof __SPEKTA_BUILD_METADATA__ === "undefined"
    ? { version: "unknown", sourceRevision: "unknown", sourceState: "unknown" }
    : __SPEKTA_BUILD_METADATA__;

export async function runningIdentity(cwd: string): Promise<{
  executable: string;
  artifactSha256: string;
}> {
  const unknown = { executable: "unknown", artifactSha256: "unknown" };
  try {
    if (!process.argv[1]) return unknown;
    const requested = resolve(process.argv[1]);
    const executable = await realpath(requested);
    // The running installation is an explicit status subject. Workspace
    // installations still obey the same eligibility rules as workspace reads.
    if (
      executable.length > 512 ||
      [...executable].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      [requested, executable].some((path) =>
        path.split(sep).some((part) => RESTRICTED_FILES.includes(part)),
      )
    )
      return unknown;
    const workspace = await resolveWorkspace({ root: cwd });
    if (
      isPathWithin(workspace.root, requested) ||
      isPathWithin(workspace.canonicalRoot, executable)
    )
      await validateReadPathAccess(requested, workspace);
    const info = await stat(executable);
    if (!info.isFile() || info.size > 10 * 1024 * 1024) return unknown;
    return {
      executable,
      artifactSha256: createHash("sha256")
        .update(await readFile(executable))
        .digest("hex"),
    };
  } catch {
    return unknown;
  }
}
