import { ToolDefinition } from "../../core/config";
import { Logger } from "../../utils/logger";
import { TOOL_REGISTRY } from "./registry";

export function validateToolDefinitions(tools: ToolDefinition[]) {
  for (const tool of tools) {
    const implementation = TOOL_REGISTRY[tool.name];

    if (!implementation) {
      Logger.warn(
        `Configuration Mismatch: Tool '${tool.name}' is defined in YAML but has no implementation in TOOL_REGISTRY.`,
      );
      continue;
    }

    const paramEntries = Object.entries(tool.params);

    for (const [key, value] of paramEntries) {
      if (!value.description || value.description.trim() === "") {
        Logger.warn(
          `Documentation Gap: Parameter '${key}' for tool '${tool.name}' lacks a description in YAML.`,
        );
      }
    }
  }
}
