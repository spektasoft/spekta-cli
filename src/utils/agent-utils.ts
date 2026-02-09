import path from "node:path";
import { getReadContent } from "../commands/read";
import { executeSafeReplace } from "../commands/replace";
import { getWriteContent } from "../commands/write";
import { Logger } from "./logger";
import { parseFilePathWithRange, tokenizeQuotedPaths } from "./read-utils";
import { ReplaceRequest } from "./replace-utils";
import { getGrepContent } from "../commands/grep";

export interface ToolCall {
  type: "read" | "write" | "replace" | "grep";
  path: string;
  content?: string;
  pattern?: string;
  globs?: string;
  raw: string;
}

export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];

  // More flexible parsing for multiple attributes
  const toolRegex =
    /<(read|write|replace|grep)\s+([^>]+?)\s*(?:\/>|>([\s\S]*?)<\/\1>)/g;

  let match;
  while ((match = toolRegex.exec(text)) !== null) {
    const fullMatch = match[0];
    const type = match[1] as ToolCall["type"];
    const attrString = match[2];
    const content = match[3] || undefined;

    // Simple attribute parser
    const attrs: Record<string, string> = {};
    const attrRegex = /([a-z_]+)=["']([^"']+)["']/gi;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(attrString)) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }

    const filePath = attrs.path || "";

    // Validate path if present
    if (
      filePath &&
      (filePath.includes("..") ||
        filePath.startsWith("/") ||
        filePath.includes("\\"))
    ) {
      Logger.warn(`Invalid path detected in tool call: ${filePath}`);
      continue;
    }

    calls.push({
      type,
      path: filePath,
      content,
      pattern: attrs.pattern,
      globs: attrs.globs,
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
  // 1. Block any attempt to use backslashes on POSIX or mixed separators
  // This prevents bypasses like "src/..\\..\\etc/passwd"
  if (filePath.includes("\\") && process.platform !== "win32") {
    return false;
  }

  // 2. Normalize and resolve to absolute path
  const normalizedPath = path.normalize(filePath);
  const resolvedPath = path.resolve(normalizedPath);
  const cwd = process.cwd();

  // 3. Ensure the path is not the same as CWD and starts with CWD
  // Adding path.sep ensures we don't match "project-dir-secret" when CWD is "project-dir"
  const isInsideCwd = resolvedPath.startsWith(cwd + path.sep);
  const isCwdItself = resolvedPath === cwd;

  // 4. Block hidden system directories (e.g., .git, .env)
  const isHidden = resolvedPath
    .split(path.sep)
    .some((part) => part.startsWith("."));

  return (isInsideCwd || isCwdItself) && !isHidden;
}

export async function executeTool(call: ToolCall): Promise<string> {
  if (call.type === "read") {
    // Tokenize and normalize the path string to support multiple files and quoted paths
    const tokens = tokenizeQuotedPaths(call.path);
    if (tokens.length === 0) {
      throw new Error("Read tool requires at least one file path.");
    }

    const requests = tokens.map((token) => {
      const req = parseFilePathWithRange(token);
      // Validate each resolved path
      if (!validateFilePath(req.path)) {
        throw new Error(`Invalid file path: ${req.path}`);
      }
      return req;
    });

    return await getReadContent(requests);
  }

  // Validate path before any operation for non-read tools
  if (!validateFilePath(call.path)) {
    throw new Error(`Invalid file path: ${call.path}`);
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
      blocks: [],
    };

    const { message, appliedCount } = await executeSafeReplace(
      request,
      call.content,
    );

    // Return minimal summary only - no additional context appending
    return `${message}`;
  }

  if (call.type === "grep") {
    return await getGrepContent({
      pattern: call.pattern || "",
      path: call.path || undefined,
      globs: call.globs,
    });
  }

  throw new Error("Unknown tool");
}
