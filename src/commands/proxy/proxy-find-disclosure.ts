import fs from "fs-extra";
import path from "path";
import { getIgnorePatterns } from "../../core/config";
import { isPathWithin, type ResolvedWorkspace } from "../../utils/workspace";
import { isEligibleEntry, type LsFilterResult } from "./proxy-ls";

/** Attribute physical find output before applying the same eligibility as ls. */
export async function filterEligibleFindEntries(
  stdout: string,
  directory: string,
  workspace: ResolvedWorkspace,
): Promise<LsFilterResult> {
  const ambiguous: LsFilterResult = {
    status: "ambiguous",
    message:
      "Listing rejected: directory entries could not be attributed reliably.",
  };
  try {
    const patterns = await getIgnorePatterns(workspace.canonicalRoot);
    const root = path.resolve(workspace.root, directory);
    const names: string[] = [];
    const lines = stdout === "" ? [] : stdout.replace(/\n$/, "").split("\n");
    for (const name of lines) {
      const target = path.resolve(workspace.root, name);
      if (!name || path.isAbsolute(name) || !isPathWithin(root, target))
        return ambiguous;
      // Every ancestor must be eligible, and physical traversal cannot visit a
      // descendant through a directory symlink (even a contained one).
      let current = target;
      let eligible = true;
      while (true) {
        if (
          !(await isEligibleEntry(
            path.relative(workspace.root, path.dirname(current)),
            path.basename(current),
            workspace,
            patterns,
          ))
        ) {
          eligible = false;
          break;
        }
        if (current !== target && (await fs.lstat(current)).isSymbolicLink()) {
          eligible = false;
          break;
        }
        if (current === root) break;
        current = path.dirname(current);
      }
      if (eligible) names.push(name);
    }
    return { status: "success", names };
  } catch {
    return ambiguous;
  }
}
