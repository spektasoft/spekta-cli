import path from "path";
import fs from "fs-extra";

const getSpektaBase = () => path.join(process.cwd(), "spekta");
const getReviewsBasePath = () => path.join(getSpektaBase(), "docs", "reviews");
const getPlansBasePath = () =>
  path.join(getSpektaBase(), "docs", "implementations");
export const getSessionsPath = async () => {
  const basePath = path.join(getSpektaBase(), "sessions");
  await ensureIgnoredDir(basePath);
  return basePath;
};

export const generateId = (): string => {
  const now = new Date();
  const format = (options: Intl.DateTimeFormatOptions) => {
    const val = new Intl.DateTimeFormat("en-GB", options).format(now);
    return val.replace(/\D/g, "");
  };

  const year = format({ year: "numeric" });
  const month = format({ month: "2-digit" }).padStart(2, "0");
  const day = format({ day: "2-digit" }).padStart(2, "0");
  const hour = format({ hour: "2-digit", hour12: false }).padStart(2, "0");
  const minute = format({ minute: "2-digit" }).padStart(2, "0");

  return `${year}${month}${day}${hour}${minute}`;
};

export const ensureIgnoredDir = async (
  dir: string,
  root: string = getSpektaBase(),
) => {
  await fs.ensureDir(dir);
  await fs.ensureDir(root);

  const spektaIgnorePath = path.join(root, ".gitignore");
  try {
    // Attempt exclusive creation
    await fs.writeFile(spektaIgnorePath, "*\n", { flag: "wx" });
  } catch (err: any) {
    if (err.code !== "EEXIST") throw err;
    // File already exists; do nothing
  }
};

export const getPlansDir = async (): Promise<string> => {
  const plansPath = getPlansBasePath();
  await ensureIgnoredDir(plansPath);
  return plansPath;
};

export const listReviewFolders = async (): Promise<string[]> => {
  const reviewsPath = getReviewsBasePath();
  if (!(await fs.pathExists(reviewsPath))) return [];
  const dirs = await fs.readdir(reviewsPath);
  return dirs
    .filter((d) => /^\d{12}$/.test(d))
    .sort((a, b) => b.localeCompare(a));
};

export const getReviewDir = async (
  isInitial: boolean,
  folderId?: string,
): Promise<{ dir: string; id: string }> => {
  const reviewsPath = getReviewsBasePath();
  if (isInitial) {
    const id = generateId();
    const dir = path.join(reviewsPath, id);
    await ensureIgnoredDir(dir);
    return { dir, id };
  }
  if (!folderId) throw new Error("Folder ID is required.");
  const dir = path.join(reviewsPath, folderId);
  if (!(await fs.pathExists(dir)))
    throw new Error(`Review folder not found: ${folderId}`);
  return { dir, id: folderId };
};

export const getHashesFromReviewFile = (fileName: string) => {
  const match = fileName.match(/^r-\d+-([0-9a-f]+)\.\.([0-9a-f]+)\.md$/i);
  return match ? { start: match[1], end: match[2] } : null;
};

const DEFAULT_METADATA = { nextNum: 1, lastFile: null };

export const getSafeMetadata = async (dir: string) => {
  return (await getNextReviewMetadata(dir)) || DEFAULT_METADATA;
};

export const getNextReviewMetadata = async (dir: string) => {
  const files = await fs.readdir(dir);
  const sequenceRegex = /^r-(\d+)-[0-9a-f]+\.\.[0-9a-f]+\.md$/i;
  const validFiles = files
    .map((f) => {
      const match = f.match(sequenceRegex);
      return match ? { name: f, num: parseInt(match[1], 10) } : null;
    })
    .filter((item): item is { name: string; num: number } => item !== null);

  if (validFiles.length === 0) return DEFAULT_METADATA;
  const lastEntry = validFiles.reduce((p, c) => (p.num > c.num ? p : c));
  return { nextNum: lastEntry.num + 1, lastFile: lastEntry.name };
};
