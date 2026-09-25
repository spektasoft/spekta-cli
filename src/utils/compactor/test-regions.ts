import type { Node } from "@xberg-io/tree-sitter-language-pack";
import { CollapseRegion } from "./types";
import {
  TEST_CALL_NAMES,
  TEST_SUITE_NAMES,
  findBodyNode,
  findCallbackNode,
} from "./ast";

export interface TestRegionContext {
  getNodeText: (node: Node) => string;
  lineOffset: number;
}

export interface TestSuiteDetection {
  handled: boolean;
  callbackBody: Node | null;
}

export function findArgumentsNode(node: Node | null): Node | null {
  if (!node) {
    return null;
  }

  for (let i = 0; i < node.childCount(); i++) {
    const child = node.child(i);
    if (child && child.kind() === "arguments") {
      return child;
    }
  }

  return null;
}

export function detectTestSuite(
  baseCallee: string,
  argsNode: Node | null,
): TestSuiteDetection {
  if (!TEST_SUITE_NAMES.has(baseCallee)) {
    return { handled: false, callbackBody: null };
  }

  if (!argsNode) {
    return { handled: true, callbackBody: null };
  }

  const targetCallback = findCallbackNode(argsNode);
  const callbackBody = targetCallback ? findBodyNode(targetCallback) : null;

  return {
    handled: true,
    callbackBody,
  };
}

export function detectTestCallRegion(
  baseCallee: string,
  argsNode: Node | null,
  context: TestRegionContext,
): CollapseRegion | null {
  if (!TEST_CALL_NAMES.has(baseCallee) || !argsNode) {
    return null;
  }

  const targetCallback = findCallbackNode(argsNode);
  const bodyNode = targetCallback ? findBodyNode(targetCallback) : null;

  if (!bodyNode || bodyNode.endPosition().row <= bodyNode.startPosition().row) {
    return null;
  }

  const openLine = bodyNode.startPosition().row + context.lineOffset;
  const closeLine = bodyNode.endPosition().row + context.lineOffset;

  if (openLine < 0 || closeLine <= openLine) {
    return null;
  }

  return {
    openLine,
    closeLine,
    type: "test",
  };
}

export function detectAssertionObjectRegions(
  calleeText: string,
  argsNode: Node | null,
  context: TestRegionContext,
): CollapseRegion[] {
  if (
    !argsNode ||
    (!calleeText.includes("toEqual") && !calleeText.includes("toMatchObject"))
  ) {
    return [];
  }

  const regions: CollapseRegion[] = [];

  for (let i = 0; i < argsNode.childCount(); i++) {
    const arg = argsNode.child(i);

    if (
      arg &&
      arg.kind() === "object" &&
      arg.endPosition().row > arg.startPosition().row
    ) {
      const openLine = arg.startPosition().row + context.lineOffset;
      const closeLine = arg.endPosition().row + context.lineOffset;

      if (openLine >= 0 && closeLine > openLine) {
        regions.push({
          openLine,
          closeLine,
          type: "object",
        });
      }
    }
  }

  return regions;
}
