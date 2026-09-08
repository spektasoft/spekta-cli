import fs from "fs-extra";
import path from "path";
import { Logger } from "../../utils/logger";
import { readYaml } from "../../utils/yaml";
import { getAssetPaths, HOME_TOOLS } from "./paths.js";
import { ToolDefinition } from "./types.js";

let cachedTools: ToolDefinition[] | null = null;
let cachedToolsKey: string | null = null;

export const resetCachedTools = () => {
  cachedTools = null;
  cachedToolsKey = null;
};

export const loadToolDefinitions = async (
  forceRefresh = false,
): Promise<ToolDefinition[]> => {
  const { ASSET_TOOLS } = getAssetPaths();
  const cacheKey = `${HOME_TOOLS}::${ASSET_TOOLS}`;

  if (cachedTools && !forceRefresh && cachedToolsKey === cacheKey) {
    return cachedTools;
  }

  const toolNames = ["read", "replace", "write", "grep"] as const;
  const tools: ToolDefinition[] = [];

  for (const name of toolNames) {
    const userPath = path.join(HOME_TOOLS, `${name}.yaml`);
    const internalPath = path.join(ASSET_TOOLS, `${name}.yaml`);

    let filePath: string;
    if (await fs.pathExists(userPath)) {
      filePath = userPath;
    } else if (await fs.pathExists(internalPath)) {
      filePath = internalPath;
    } else {
      Logger.warn(`Tool definition missing for ${name}, skipping.`);
      continue;
    }

    try {
      const data = await readYaml<{
        name: string;
        description: string;
        params: Record<string, { description: string }>;
        xml_example: string;
      }>(filePath);

      // Validate required fields
      if (
        !data ||
        !data.name ||
        !data.description ||
        !data.params ||
        !data.xml_example
      ) {
        Logger.warn(
          `Invalid tool definition for ${name} in ${filePath}: missing required fields`,
        );
        continue;
      }

      // Sanitize: extract ONLY safe string fields, discard any unexpected properties
      const safeDefinition: ToolDefinition = {
        name: data.name.trim(),
        description: data.description.trim(),
        params: Object.fromEntries(
          Object.entries(data.params).map(([key, param]) => [
            key,
            { description: param.description?.trim() || "" },
          ]),
        ),
        xml_example: data.xml_example.trim(),
      };

      tools.push(safeDefinition);
    } catch (err: any) {
      Logger.warn(
        `Failed to load tool ${name} from ${filePath}: ${err.message}`,
      );
    }
  }

  cachedTools = tools;
  cachedToolsKey = cacheKey;
  return tools;
};
