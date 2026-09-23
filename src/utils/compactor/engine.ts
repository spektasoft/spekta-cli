import type { Node, Parser, Tree } from "@xberg-io/tree-sitter-language-pack";
import { CollapseRegion } from "./types";
import { getOrCreateParser, resolveLanguage } from "./parser";
import { CONTAINER_NODE_KINDS } from "./ast";
import {
  detectAssertionObjectRegions,
  detectTestCallRegion,
  detectTestSuite,
  findArgumentsNode,
} from "./test-regions";
import { detectFunctionRegion } from "./function-regions";

export { resolveLanguage };

export function extractCollapseRegions(
  filePath: string,
  content: string,
): CollapseRegion[] {
  const language = resolveLanguage(filePath);
  let parser: Parser;
  try {
    parser = getOrCreateParser(language);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Tree-sitter compaction failed to load parser for "${language}": ${message}`,
      { cause: error },
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

  let tree: Tree | null;
  try {
    tree = parser.parse(parseContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Tree-sitter compaction failed parsing "${filePath}": ${message}`,
      { cause: error },
    );
  }

  if (!tree) {
    return [];
  }

  const contentBuffer = Buffer.from(parseContent, "utf8");
  const effectiveLines = parseContent.split("\n");
  const regions: CollapseRegion[] = [];

  function getNodeText(targetNode: Node): string {
    return contentBuffer
      .subarray(targetNode.startByte(), targetNode.endByte())
      .toString("utf8");
  }

  function visit(node: Node | null): void {
    if (!node) return;

    const nodeType: string = node.kind();

    if (nodeType === "call_expression") {
      const callee = node.child(0);
      const calleeText = callee ? getNodeText(callee) : "";
      const baseCallee = calleeText.split(".")[0];
      const argsNode = findArgumentsNode(node);

      const suite = detectTestSuite(baseCallee, argsNode);
      if (suite.handled) {
        if (suite.callbackBody) {
          visit(suite.callbackBody);
          return;
        }

        for (let i = 0; i < node.childCount(); i++) {
          visit(node.child(i));
        }
        return;
      }

      const testRegion = detectTestCallRegion(baseCallee, argsNode, {
        getNodeText,
        lineOffset,
      });

      if (testRegion) {
        regions.push(testRegion);
        return;
      }

      regions.push(
        ...detectAssertionObjectRegions(calleeText, argsNode, {
          getNodeText,
          lineOffset,
        }),
      );
    }

    if (CONTAINER_NODE_KINDS.has(nodeType)) {
      for (let i = 0; i < node.childCount(); i++) {
        visit(node.child(i));
      }
      return;
    }

    const functionRegion = detectFunctionRegion(node, {
      language,
      lineOffset,
      effectiveLines,
    });

    if (functionRegion) {
      regions.push(functionRegion);
    }

    for (let i = 0; i < node.childCount(); i++) {
      visit(node.child(i));
    }
  }

  visit(tree.rootNode());
  return regions;
}
