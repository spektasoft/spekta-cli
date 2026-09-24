import fs from "fs-extra";
import YAML from "yaml";
import path from "path";

/**
 * Reads a YAML file and parses it into a typed object.
 * Returns null if the file does not exist.
 */
export async function readYaml<T>(filePath: string): Promise<T | null> {
  if (!(await fs.pathExists(filePath))) {
    return null;
  }
  const content = await fs.readFile(filePath, "utf8");
  try {
    return YAML.parse(content) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse YAML at ${filePath}: ${message}`, {
      cause: err,
    });
  }
}

/**
 * Serializes an object to YAML and writes it to a file.
 */
export async function writeYaml(
  filePath: string,
  data: unknown,
): Promise<void> {
  const content = YAML.stringify(data, {
    indent: 2,
    blockQuote: "literal",
  });
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}
