import path from "path";
import fs from "fs-extra";

export const getReviewDir = async (isInitial: boolean, folderId?: string) => {
  const base = path.join(process.cwd(), "temp", "docs", "reviews");
  if (isInitial) {
    const now = new Date();

    const format = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-GB", options).format(now);

    const year = format({ year: "numeric" });
    const month = format({ month: "2-digit" });
    const day = format({ day: "2-digit" });
    const hour = format({ hour: "2-digit", hour12: false });
    const minute = format({ minute: "2-digit" });

    const id = `${year}${month}${day}${hour}${minute}`;

    const dir = path.join(base, id);
    await fs.ensureDir(dir);
    return { dir, id };
  }

  const dir = path.join(base, folderId!);
  if (!(await fs.pathExists(dir))) {
    throw new Error(`Review folder not found: ${folderId}`);
  }
  return { dir, id: folderId! };
};

export const getNextReviewMetadata = async (dir: string) => {
  const files = await fs.readdir(dir);
  const sequenceRegex = /^r-(\d+)-/;

  const validFiles = files
    .map((f) => {
      const match = f.match(sequenceRegex);
      return match ? { name: f, num: parseInt(match[1], 10) } : null;
    })
    .filter((item): item is { name: string; num: number } => item !== null);

  if (validFiles.length === 0) {
    return { nextNum: 1, lastFile: null };
  }

  const lastEntry = validFiles.reduce((prev, current) =>
    prev.num > current.num ? prev : current
  );

  return {
    nextNum: lastEntry.num + 1,
    lastFile: lastEntry.name,
  };
};
