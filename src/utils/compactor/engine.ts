import { CollapseRegion } from "./types";
import { getOrCreateParser, resolveLanguage } from "./parser";
import {
  CONTAINER_NODE_KINDS,
  FUNCTION_NODE_KINDS,
  TEST_CALL_NAMES,
  TEST_SUITE_NAMES,
  findBodyNode,
  findCallbackNode,
} from "./ast";

export { resolveLanguage };

export function extractCollapseRegions(
  filePath: string,
  content: string,
): CollapseRegion[] {
  const language = resolveLanguage(filePath);
  let parser: ReturnType<typeof getParser>;
  try {
    parser = getOrCreateParser(language);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Tree-sitter compaction failed to load parser for "${language}": ${message}`,
    );
  }

  let parseContent = content;
  let lineOffset = 0;

  if (
    language === "php" &&
    !content.includes("<?php") &&
    !content.includes("<?")
  ) {
    parseContent = `<?php\n${content}`;
    lineOffset = -1;
  }

  let tree: ReturnType<typeof parser.parse>;
  try {
    tree = parser.parse(parseContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Tree-sitter compaction failed parsing "${filePath}": ${message}`,
    );
  }

  const contentBuffer = Buffer.from(parseContent, "utf8");
  const effectiveLines = parseContent.split("\n");
  const regions: CollapseRegion[] = [];

  function getNodeText(targetNode: any): string {
    return contentBuffer
      .subarray(targetNode.startByte(), targetNode.endByte())
      .toString("utf8");
  }

  function visit(node: any): void {
    if (!node) return;

    const nodeType: string = node.kind();

    if (nodeType === "call_expression") {
      const callee = node.child(0);
      const calleeText = callee ? getNodeText(callee) : "";
      const baseCallee = calleeText.split(".")[0];

      if (TEST_SUITE_NAMES.has(baseCallee)) {
        let argsNode: any = null;
        for (let i = 0; i < node.childCount(); i++) {
          const child = node.child(i);
          if (child && child.kind() === "arguments") {
            argsNode = child;
            break;
          }
        }

        if (argsNode) {
          const targetCallback = findCallbackNode(argsNode);
          const bodyNode = targetCallback ? findBodyNode(targetCallback) : null;
          if (bodyNode) {
            visit(bodyNode);
            return;
          }
        }

        for (let i = 0; i < node.childCount(); i++) {
          visit(node.child(i));
        }
        return;
      }

      let argsNode: any = null;
      for (let i = 0; i < node.childCount(); i++) {
        const child = node.child(i);
        if (child && child.kind() === "arguments") {
          argsNode = child;
          break;
        }
      }

      if (TEST_CALL_NAMES.has(baseCallee) && argsNode) {
        const targetCallback = findCallbackNode(argsNode);
        const bodyNode = targetCallback ? findBodyNode(targetCallback) : null;

        if (
          bodyNode &&
          bodyNode.endPosition().row > bodyNode.startPosition().row
        ) {
          const openLine = bodyNode.startPosition().row + lineOffset;
          const closeLine = bodyNode.endPosition().row + lineOffset;
          if (openLine >= 0 && closeLine > openLine) {
            regions.push({
              openLine,
              closeLine,
              type: "test",
            });
            return;
          }
        }
      }

      if (
        argsNode &&
        (calleeText.includes("toEqual") || calleeText.includes("toMatchObject"))
      ) {
        for (let j = 0; j < argsNode.childCount(); j++) {
          const arg = argsNode.child(j);
          if (
            arg &&
            arg.kind() === "object" &&
            arg.endPosition().row > arg.startPosition().row
          ) {
            const openLine = arg.startPosition().row + lineOffset;
            const closeLine = arg.endPosition().row + lineOffset;
            if (openLine >= 0 && closeLine > openLine) {
              regions.push({
                openLine,
                closeLine,
                type: "object",
              });
            }
          }
        }
      }
    }

    if (CONTAINER_NODE_KINDS.has(nodeType)) {
      for (let i = 0; i < node.childCount(); i++) {
        visit(node.child(i));
      }
      return;
    }

    if (FUNCTION_NODE_KINDS.has(nodeType)) {
      const bodyNode = findBodyNode(node);

      if (
        bodyNode &&
        bodyNode.endPosition().row > bodyNode.startPosition().row
      ) {
        // Python's body node (kind "block") starts at the first indented
        // statement, not at the "def"/"class" line, since Python has no
        // opening brace. Anchoring on the node's own start row (the
        // def/class line) keeps the signature paired with its collapsed
        // region, matching the pairing brace languages get for free. There
        // is no equivalent fix for the closing row: Python has no closing
        // delimiter, so the last body statement remains visible verbatim.
        const startRow =
          language === "python"
            ? node.startPosition().row
            : bodyNode.startPosition().row;
        const endRow = bodyNode.endPosition().row;
        const snippet = effectiveLines.slice(startRow, endRow + 1).join(" ");

        if (snippet.length >= 80 || endRow - startRow > 1) {
          const openLine = startRow + lineOffset;
          const closeLine = endRow + lineOffset;
          if (openLine >= 0 && closeLine > openLine) {
            regions.push({
              openLine,
              closeLine,
              type: nodeType.includes("method")
                ? "method"
                : nodeType.includes("arrow")
                  ? "arrow"
                  : "function",
            });
          }
        }
      }
    }

    for (let i = 0; i < node.childCount(); i++) {
      visit(node.child(i));
    }
  }

  visit(tree.rootNode());
  return regions;
}
