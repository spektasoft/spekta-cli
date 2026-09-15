import fs from "fs-extra";
import path from "path";

export const DEFAULT_DIAGNOSTICS_DIR = path.join(
  process.cwd(),
  "spekta",
  "docs",
  "diagnostics",
);

export function formatReportFileName(date: Date, suffix?: number): string {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");

  const base = `${year}${month}${day}${hours}${minutes}`;
  const suffixPart = suffix !== undefined ? `-${suffix}` : "";
  return `${base}${suffixPart}.md`;
}

export async function saveDiagnosticReport(
  content: string,
  baseDir: string = DEFAULT_DIAGNOSTICS_DIR,
  timestamp: Date = new Date(),
): Promise<string> {
  await fs.ensureDir(baseDir);

  const primaryName = formatReportFileName(timestamp);
  let targetPath = path.join(baseDir, primaryName);

  if (!(await fs.pathExists(targetPath))) {
    await fs.writeFile(targetPath, content, "utf-8");
    return targetPath;
  }

  let counter = 1;
  while (true) {
    const candidateName = formatReportFileName(timestamp, counter);
    targetPath = path.join(baseDir, candidateName);
    if (!(await fs.pathExists(targetPath))) {
      await fs.writeFile(targetPath, content, "utf-8");
      return targetPath;
    }
    counter += 1;
  }
}
