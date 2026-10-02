import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, vi } from "vitest";

export let fixture: string;
export let workspace: string;

export function useFindPolicyFixture(): void {
  beforeEach(() => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), "spekta-find-policy-"));
    workspace = path.join(fixture, "workspace");
    for (const dir of [
      "directory/nested",
      "space name",
      "..internal",
      "-directory",
      ".env",
    ])
      fs.ensureDirSync(path.join(workspace, dir));
    fs.ensureDirSync(path.join(fixture, "outside"));
    fs.writeFileSync(path.join(workspace, "file.txt"), "file");
    for (const [target, name] of [
      ["directory", "internal-alias"],
      [path.join(fixture, "outside"), "escape"],
      [".env", "restricted-alias"],
      ["missing", "dangling"],
    ])
      fs.symlinkSync(
        path.isAbsolute(target) ? target : path.join(workspace, target),
        path.join(workspace, name),
        "dir",
      );
    vi.spyOn(process, "cwd").mockReturnValue(workspace);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.removeSync(fixture);
  });
}
