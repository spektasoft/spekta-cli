import os from "os";
import path from "path";

export function getTempPath(prefix: string): string {
  const fileName = `${prefix}-${Date.now()}.md`;
  return path.normalize(path.join(os.tmpdir(), fileName));
}
