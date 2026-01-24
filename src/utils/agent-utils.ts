import path from "node:path";
import { getReadContent } from "../commands/read";
import { getWriteContent } from "../commands/write";
import { executeSafeReplace } from "../commands/replace";
import { parseFilePathWithRange } from "./read-utils";
import { ReplaceRequest } from "./replace-utils";
import { Logger } from "./logger";

export interface ToolCall {
  type: "read" | "write" | "replace";
  path: string;
  content?: string;
  raw: string;
}

export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];

  // More robust parsing with better error handling
  const toolRegex =
    /<(read|write|replace)\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/\1>|<(read)\s+path=["']([^"']+)["']\s*\/>/g;

  let match;
  while ((match = toolRegex.exec(text)) !== null) {
    const fullMatch = match[0];

    const type = (match[1] || match[4]) as "read" | "write" | "replace";
    const filePath = match[2] || match[5];
    const content = match[3] || undefined;

    // Validate path doesn't contain dangerous patterns
    if (
      filePath.includes("..") ||
      filePath.startsWith("/") ||
      filePath.includes("\\")
    ) {
      Logger.warn(`Invalid path detected in tool call: ${filePath}`);
      continue; // Skip invalid paths
    }

    calls.push({
      type,
      path: filePath,
      content,
      raw: fullMatch,
    });
  }

  return calls;
}

/**
 * Validates that a file path is safe to access.
 * Must be within the current working directory.
 */
export function validateFilePath(filePath: string): boolean {
  // Resolve to absolute path and ensure it's within current working directory
  const resolvedPath = path.resolve(filePath);
  const cwd = process.cwd();

  // Check if resolved path is within current working directory
  return resolvedPath.startsWith(cwd + path.sep) || resolvedPath === cwd;
}

export async function executeTool(call: ToolCall): Promise<string> {
  // Validate path before any operation
  if (!validateFilePath(call.path)) {
    throw new Error(`Invalid file path: ${call.path}`);
  }

  if (call.type === "read") {
    const req = parseFilePathWithRange(call.path);
    return await getReadContent([req]);
  }
  if (call.type === "write") {
    const res = await getWriteContent(call.path, call.content || "");
    return res.message;
  }
  if (call.type === "replace") {
    if (!call.content) {
      throw new Error("Replace tool requires content (search/replace blocks)");
    }

    const request: ReplaceRequest = {
      path: call.path,
      blocks: [], // will be parsed from content
    };

    const { message, appliedCount } = await executeSafeReplace(
      request,
      call.content,
    );

    return `${message}\nApplied ${appliedCount} change(s).`;
  }
  throw new Error("Unknown tool");
}
