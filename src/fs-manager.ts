import path from "path";
import fs from "fs-extra";

export const getReviewDir = (isInitial: boolean, folderId?: string) => {
  const base = path.join(process.cwd(), ".temp", "docs", "reviews");
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
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("r-") && f.endsWith(".md"));
  if (files.length === 0) return { nextNum: 1, lastFile: null };
  const nums = files.map((f) => parseInt(f.split("-")[1]));
  const lastNum = Math.max(...nums);
  const lastFile = files.find((f) =>
    f.includes(`r-${String(lastNum).padStart(3, "0")}`)
  );
  return { nextNum: lastNum + 1, lastFile };
};
