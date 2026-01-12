import path from "path";
import fs from "fs-extra";

export const getReviewDir = (isInitial: boolean, folderId?: string) => {
  const base = path.join(process.cwd(), "temp", "docs", "reviews");
  if (isInitial) {
    const id = new Date().toISOString().replace(/[-T:]/g, "").slice(0, 12);
    const dir = path.join(base, id);
    fs.ensureDirSync(dir);
    return { dir, id };
  }
  const dir = path.join(base, folderId!);
  if (!fs.existsSync(dir)) throw new Error("Folder ID not found");
  return { dir, id: folderId! };
};

export const getNextReviewMetadata = (dir: string) => {
  const files = fs.readdirSync(dir);

  // Regex: matches 'r-', captures digits, followed by '-'
  const sequenceRegex = /^r-(\d+)-/;

  const validFiles = files
    .map((f) => {
      const match = f.match(sequenceRegex);
      if (!match) return null;
      return {
        name: f,
        num: parseInt(match[1], 10),
      };
    })
    .filter((item): item is { name: string; num: number } => item !== null);

  if (validFiles.length === 0) {
    return { nextNum: 1, lastFile: null };
  }

  // Find the file with the highest sequence number
  const lastEntry = validFiles.reduce((prev, current) =>
    prev.num > current.num ? prev : current
  );

  return {
    nextNum: lastEntry.num + 1,
    lastFile: lastEntry.name,
  };
};
