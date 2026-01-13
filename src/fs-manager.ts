import path from "path";
import fs from "fs-extra";

const REVIEWS_BASE_PATH = path.join(process.cwd(), "temp", "docs", "reviews");

export const listReviewFolders = async (): Promise<string[]> => {
  if (!(await fs.pathExists(REVIEWS_BASE_PATH))) {
    return [];
  }
  const dirs = await fs.readdir(REVIEWS_BASE_PATH);
  // Filter for YYYYMMDDHHmm pattern and sort descending
  return dirs
    .filter((d) => /^\d{12}$/.test(d))
    .sort((a, b) => b.localeCompare(a));
};

export const getHashesFromReviewFile = (
  fileName: string
): { start: string; end: string } | null => {
  const hashRegex = /^r-\d+-([0-9a-f]+)\.\.([0-9a-f]+)\.md$/i;
  const match = fileName.match(hashRegex);
  if (!match) return null;
  return {
    start: match[1],
    end: match[2],
  };
};

export interface ReviewDirInfo {
  dir: string;
  id: string;
}

export const getReviewDir = async (
  isInitial: boolean,
  folderId?: string
): Promise<ReviewDirInfo> => {
  const base = REVIEWS_BASE_PATH;

  if (isInitial) {
    const now = new Date();

    const format = (options: Intl.DateTimeFormatOptions) => {
      const val = new Intl.DateTimeFormat("en-GB", options).format(now);
      // Remove any non-digit characters (fixes issues with some Node/ICU versions)
      return val.replace(/\D/g, "");
    };

    const year = format({ year: "numeric" });
    const month = format({ month: "2-digit" }).padStart(2, "0");
    const day = format({ day: "2-digit" }).padStart(2, "0");
    const hour = format({ hour: "2-digit", hour12: false }).padStart(2, "0");
    const minute = format({ minute: "2-digit" }).padStart(2, "0");

    const id = `${year}${month}${day}${hour}${minute}`;

    const dir = path.join(base, id);
    await fs.ensureDir(dir);
    return { dir, id };
  }

  if (!folderId) {
    throw new Error("Folder ID is required for non-initial review.");
  }

  const dir = path.join(base, folderId);
  if (!(await fs.pathExists(dir))) {
    throw new Error(`Review folder not found: ${folderId}`);
  }
  return { dir, id: folderId };
};

export const getNextReviewMetadata = async (dir: string) => {
  const files = await fs.readdir(dir);
  // Matches r-001- and captures the number, ensuring it's followed by hex hashes and double dots
  const sequenceRegex = /^r-(\d+)-[0-9a-f]+\.\.[0-9a-f]+\.md$/i;

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
