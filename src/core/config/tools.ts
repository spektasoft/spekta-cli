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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.warn(`Failed to load tool ${name} from ${filePath}: ${message}`);
    }
  }

  // The loader enumerates the installed YAML templates above, so register
  // the new basic search tool here to keep it in bundled MCP deployments.
  tools.push({
    name: "spekta_rg",
    description:
      "Search eligible workspace files with ripgrep. Supply one or more regex patterns and optional workspace paths and globs. Repeated patterns use alternative matching; when patterns are omitted, the first positional CLI operand is the pattern and later operands are paths. CLI supports -e/--regexp and -- option termination; unsupported flags are rejected.",
    params: {
      patterns: {
        description:
          "Regex patterns to search; repeated patterns match as alternatives. At least one is required.",
      },
      paths: {
        description:
          "File and directory paths to search. Empty or omitted searches the workspace root recursively.",
      },
      globs: {
        description:
          "Ordered ripgrep glob filters, supplied as separate values.",
      },
      case_mode: {
        description: "Case mode: sensitive (default), insensitive, or smart.",
      },
    },
    xml_example:
      '<rg patterns="[&quot;class ReplSession&quot;,&quot;interface ReplSession&quot;]" paths="[&quot;src&quot;,&quot;docs&quot;]" />',
  });

  cachedTools = tools;
  cachedToolsKey = cacheKey;
  return tools;
};
