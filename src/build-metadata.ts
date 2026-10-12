import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";
import type { BuildMetadata } from "./build-identity.ts";

// Capture provenance during the existing Vite build, never from timestamps or
// from whatever checkout happens to be inspected when status is requested.
export function buildMetadataPlugin(root: string): Plugin {
  return {
    name: "spekta-build-metadata",
    apply: "build",
    config() {
      const metadata: BuildMetadata = {
        version: "unknown",
        sourceRevision: "unknown",
        sourceState: "unknown",
      };
      try {
        const packageJson = JSON.parse(
          readFileSync(join(root, "package.json"), "utf8"),
        ) as { version?: unknown };
        if (
          typeof packageJson.version === "string" &&
          /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][\w.-]+)?$/.test(
            packageJson.version,
          ) &&
          packageJson.version.length <= 80
        )
          metadata.version = packageJson.version;
      } catch {
        /* Unavailable package identity stays unknown. */
      }
      try {
        const git = (...args: string[]) =>
          execFileSync("git", ["-C", root, ...args], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 3000,
            maxBuffer: 1024 * 1024,
          }).trim();
        if (
          realpathSync(git("rev-parse", "--show-toplevel")) ===
          realpathSync(root)
        ) {
          const revision = git("rev-parse", "HEAD");
          if (/^[a-f0-9]{40,64}$/.test(revision)) {
            metadata.sourceRevision = revision;
            metadata.sourceState = git(
              "status",
              "--porcelain",
              "--untracked-files=normal",
            )
              ? "modified"
              : "clean";
          }
        }
      } catch {
        /* Unverifiable provenance stays unknown. */
      }
      return {
        define: { __SPEKTA_BUILD_METADATA__: JSON.stringify(metadata) },
      };
    },
  };
}
