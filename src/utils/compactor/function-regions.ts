import { CollapseRegion } from "./types";
import { FUNCTION_NODE_KINDS, findBodyNode } from "./ast";

export interface FunctionRegionContext {
  language: string;
  lineOffset: number;
  effectiveLines: string[];
}

export function detectFunctionRegion(
  node: any,
  context: FunctionRegionContext,
): CollapseRegion | null {
  if (!FUNCTION_NODE_KINDS.has(node.kind())) {
    return null;
  }

  const bodyNode = findBodyNode(node);

  if (!bodyNode || bodyNode.endPosition().row <= bodyNode.startPosition().row) {
    return null;
  }

  const startRow =
    context.language === "python"
      ? node.startPosition().row
      : bodyNode.startPosition().row;
  const endRow = bodyNode.endPosition().row;
  const snippet = context.effectiveLines.slice(startRow, endRow + 1).join(" ");

  if (snippet.length < 80 && endRow - startRow <= 1) {
    return null;
  }

  const openLine = startRow + context.lineOffset;
  const closeLine = endRow + context.lineOffset;

  if (openLine < 0 || closeLine <= openLine) {
    return null;
  }

  return {
    openLine,
    closeLine,
    type: node.kind().includes("method")
      ? "method"
      : node.kind().includes("arrow")
        ? "arrow"
        : "function",
  };
}
