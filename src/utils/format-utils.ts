import prettier from "prettier";
import path from "path";
import fs from "fs-extra";
import { execa } from "execa";
import { formatKotlinFileInPlace } from "./gradle-format-utils";

async function runPintInPlace(filePath: string): Promise<boolean> {
  const pintPath = "./vendor/bin/pint";
  try {
    const pintExists = await fs.pathExists(pintPath);
    if (!pintExists) return false;
    await execa(pintPath, [filePath]);
    return true;
  } catch (err) {
    console.warn(
      `Pint formatting failed for ${filePath}. Falling back to Prettier.`,
    );
    return false;
  }
}

export async function formatFileInPlace(filePath: string): Promise<void> {
  const normalizedPath = filePath.toLowerCase();
  const isPhp = normalizedPath.endsWith(".php");
  const isKotlin =
    normalizedPath.endsWith(".kt") || normalizedPath.endsWith(".kts");

  if (isPhp) {
    if (await runPintInPlace(filePath)) return;
  }

  if (isKotlin) {
    await formatKotlinFileInPlace(filePath);
    return;
  }

  try {
    const absolutePath = path.resolve(filePath);
    const content = await fs.readFile(absolutePath, "utf-8");
    const options = await prettier.resolveConfig(absolutePath);
    const formatted = await prettier.format(content, {
      ...options,
      filepath: absolutePath,
    });
    if (content !== formatted) {
      await fs.writeFile(absolutePath, formatted, "utf-8");
    }
  } catch (err: any) {
    console.warn(`Prettier formatting failed for ${filePath}: ${err.message}.`);
  }
}
