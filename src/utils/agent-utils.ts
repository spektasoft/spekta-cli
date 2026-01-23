import { getReadContent } from "../commands/read";
import { getWriteContent } from "../commands/write";
import { getReplaceContent } from "../commands/replace";
import { parseFilePathWithRange } from "./read-utils";
import { ReplaceRequest } from "./replace-utils";

export interface ToolCall {
  type: "read" | "write" | "replace";
  path: string;
  content?: string;
  raw: string;
}

export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];

  // Parse <read path="..." />
  const readRegex = /<read\s+path=["']([^"']+)["']\s*\/>/g;
  let match;
  while ((match = readRegex.exec(text)) !== null) {
    calls.push({ type: "read", path: match[1], raw: match[0] });
  }

  // Parse <write path="...">...</write>
  const writeRegex = /<write\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/write>/g;
  while ((match = writeRegex.exec(text)) !== null) {
    calls.push({
      type: "write",
      path: match[1],
      content: match[2],
      raw: match[0],
    });
  }

  // Parse <replace path="...">...</replace>
  const replaceRegex =
    /<replace\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/replace>/g;
  while ((match = replaceRegex.exec(text)) !== null) {
    calls.push({
      type: "replace",
      path: match[1],
      content: match[2],
      raw: match[0],
    });
  }

  return calls;
}

export async function executeTool(call: ToolCall): Promise<string> {
  if (call.type === "read") {
    const req = parseFilePathWithRange(call.path);
    return await getReadContent([req]);
  }
  if (call.type === "write") {
    const res = await getWriteContent(call.path, call.content || "");
    return res.message;
  }
  if (call.type === "replace") {
    const req: ReplaceRequest = { path: call.path, blocks: [] };
    const res = await getReplaceContent(req, call.content || "");
    return res.message;
  }
  throw new Error("Unknown tool");
}
