import fs from "fs-extra";
import path from "path";
import nunjucks from "nunjucks";

import { getAssetPaths, HOME_PROMPTS } from "./paths.js";

export type PartialSelectionState = "include" | "exclude";

export interface PartialSelection {
  include: string[];
  exclude: string[];
}

export interface PromptPartial {
  name: string;
  filePath: string;
}

const normalizePartialName = (name: string): string =>
  name.replace(/\\/g, "/").replace(/^\/+/, "");

const collectPartials = async (rootDir: string): Promise<PromptPartial[]> => {
  const partialsDir = path.join(rootDir, "partials");
  if (!(await fs.pathExists(partialsDir))) return [];

  const results: PromptPartial[] = [];

  const scan = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await scan(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;

      const relativePath = normalizePartialName(
        path.relative(partialsDir, absolutePath),
      );

      results.push({
        name: relativePath,
        filePath: absolutePath,
      });
    }
  };

  await scan(partialsDir);
  return results;
};

export const listPartials = async (): Promise<PromptPartial[]> => {
  const assetPaths = getAssetPaths();
  const result = new Map<string, PromptPartial>();

  for (const partial of await collectPartials(assetPaths.ASSET_PROMPTS)) {
    result.set(partial.name, partial);
  }

  for (const partial of await collectPartials(HOME_PROMPTS)) {
    result.set(partial.name, partial);
  }

  return Array.from(result.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
};

export const validatePartialSelection = async (
  selection: PartialSelection,
): Promise<PartialSelection> => {
  const available = await listPartials();
  const availableNames = new Set(available.map((partial) => partial.name));

  const requested = [...selection.include, ...selection.exclude];

  for (const name of requested) {
    const normalized = normalizePartialName(name);

    if (!availableNames.has(normalized)) {
      throw new Error(
        `Unknown partial '${name}'. Available partials: ${
          available.map((partial) => partial.name).join(", ") || "none"
        }`,
      );
    }
  }

  return {
    include: selection.include.map(normalizePartialName),
    exclude: selection.exclude.map(normalizePartialName),
  };
};

export const resolveSelectedPartials = (
  available: string[],
  selection: PartialSelection,
): string[] => {
  const includes = new Set(selection.include);
  const excludes = new Set(selection.exclude);

  if (includes.size > 0) {
    return available.filter((name) => includes.has(name));
  }

  return available.filter((name) => !excludes.has(name));
};

export class SelectivePartialLoader extends nunjucks.FileSystemLoader {
  constructor(
    searchPaths: string | string[],
    private readonly selectedPartials: ReadonlySet<string>,
  ) {
    super(searchPaths, { noCache: true });
  }

  getSource(
    name: string,
    ...args: Parameters<nunjucks.FileSystemLoader["getSource"]> extends [
      any,
      ...infer Rest,
    ]
      ? Rest
      : never
  ) {
    const normalized = normalizePartialName(name);
    const marker = "partials/";

    if (normalized.startsWith(marker)) {
      const partialName = normalized.slice(marker.length);

      if (!this.selectedPartials.has(partialName)) {
        return {
          src: "",
          path: name,
        };
      }
    }

    return super.getSource(name, ...args);
  }
}
