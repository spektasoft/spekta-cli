import os from "os";
import path from "path";
import fs from "fs-extra";

export function getTempPath(prefix: string): string {
  const tmpDir = os.tmpdir();

  try {
    fs.accessSync(tmpDir, fs.constants.W_OK);
  } catch (err) {
    throw new Error(`Temporary directory is not writable: ${tmpDir}`);
  }

  const fileName = `${prefix}-${Date.now()}.md`;
  return path.normalize(path.join(tmpDir, fileName));
}
