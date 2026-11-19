import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, extname, resolve } from "node:path";

function executableExtensions(platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return [""];
  return (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter(Boolean)
    .map((extension) => extension.toLowerCase());
}

export async function findExecutableOnPath(
  name: string,
  pathValue: string,
): Promise<string | undefined> {
  const windows = process.platform === "win32";
  const extension = extname(name);
  const names = windows
    ? extension
      ? [name]
      : [...executableExtensions(process.platform).map((suffix) => `${name}${suffix}`), name]
    : [name];

  for (const rawDirectory of pathValue.split(delimiter).filter(Boolean)) {
    const directory =
      windows && rawDirectory.startsWith('"') && rawDirectory.endsWith('"')
        ? rawDirectory.slice(1, -1)
        : rawDirectory;
    for (const candidateName of names) {
      const candidate = resolve(directory, candidateName);
      try {
        await access(candidate, windows ? constants.F_OK : constants.X_OK);
        if ((await stat(candidate)).isFile()) return candidate;
      } catch {
        // Continue through PATHEXT entries and PATH directories.
      }
    }
  }
  return undefined;
}
