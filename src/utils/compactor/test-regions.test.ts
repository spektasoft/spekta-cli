import type { Node } from "@xberg-io/tree-sitter-language-pack";
import { describe, expect, it } from "vitest";

import {
  detectAssertionObjectRegions,
  detectTestCallRegion,
  detectTestSuite,
  findArgumentsNode,
} from "./test-regions";
import { getOrCreateParser } from "./parser";

function parse(code: string): Node {
  const tree = getOrCreateParser("typescript").parse(code);
  const root = tree?.rootNode();
  if (!root) {
    throw new Error("Failed to parse code");
  }
  return root;
}

function getNodeText(node: Node, code: string): string {
  const buffer = Buffer.from(code, "utf8");
  return buffer.subarray(node.startByte(), node.endByte()).toString("utf8");
}

describe("findArgumentsNode", () => {
  it("finds an arguments node on a call expression", () => {
    const code = `test("works", () => {
  expect(value).toEqual({ a: 1 });
});`;
    const root = parse(code);
    const call = root.child(0)?.child(0) ?? null;

    expect(findArgumentsNode(call)).toBeTruthy();
  });
});

describe("detectTestSuite", () => {
  it("limits suite traversal to the callback body", () => {
    const code = `describe("suite", () => {
  test("works", () => {
    return true;
  });
});`;
    const root = parse(code);
    const call = root.child(0)?.child(0) ?? null;
    const argsNode = findArgumentsNode(call);

    const result = detectTestSuite("describe", argsNode);

    expect(result.handled).toBe(true);
    expect(result.callbackBody).toBeTruthy();
  });
});

describe("detectTestCallRegion", () => {
  it("returns a test region for a multi-line callback", () => {
    const code = `test("works", () => {
  const value = 1;
  return value;
});`;
    const root = parse(code);
    const call = root.child(0)?.namedChild(0) ?? null;
    const argsNode = findArgumentsNode(call);

    const result = detectTestCallRegion("test", argsNode, {
      getNodeText: (node) => getNodeText(node, code),
      lineOffset: 0,
    });

    expect(result).toEqual({
      openLine: 0,
      closeLine: 3,
      type: "test",
    });
  });
});

describe("detectAssertionObjectRegions", () => {
  it("detects a multi-line matcher object", () => {
    const code = `expect(value).toEqual({
  a: 1,
  b: 2,
});`;
    const root = parse(code);
    const call = root.child(0)?.namedChild(0) ?? null;
    const argsNode = findArgumentsNode(call);

    const result = detectAssertionObjectRegions("toEqual", argsNode, {
      getNodeText: (node) => getNodeText(node, code),
      lineOffset: 0,
    });

    expect(result).toEqual([
      {
        openLine: 0,
        closeLine: 3,
        type: "object",
      },
    ]);
  });
});
