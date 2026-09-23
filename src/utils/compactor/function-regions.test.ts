import type { Node } from "@xberg-io/tree-sitter-language-pack";
import { describe, expect, it } from "vitest";

import { detectFunctionRegion } from "./function-regions";
import { getOrCreateParser } from "./parser";

function parse(language: string, code: string): Node {
  const tree = getOrCreateParser(language).parse(code);
  const root = tree?.rootNode();
  if (!root) {
    throw new Error(`Failed to parse ${language} code`);
  }
  return root;
}

describe("detectFunctionRegion", () => {
  it("detects a TypeScript function using its body bounds", () => {
    const code = `function calculate() {
  const x = 1;
  return x;
}`;
    const root = parse("typescript", code);
    const node = root.child(0);
    if (!node) throw new Error("Expected child node");

    expect(
      detectFunctionRegion(node, {
        language: "typescript",
        lineOffset: 0,
        effectiveLines: code.split("\n"),
      }),
    ).toEqual({
      openLine: 0,
      closeLine: 3,
      type: "function",
    });
  });

  it("anchors Python functions on the definition line", () => {
    const code = `def calculate():
    x = 1
    return x
`;
    const root = parse("python", code);
    const node = root.child(0);
    if (!node) throw new Error("Expected child node");

    const result = detectFunctionRegion(node, {
      language: "python",
      lineOffset: 0,
      effectiveLines: code.split("\n"),
    });

    expect(result?.openLine).toBe(0);
    expect(result?.type).toBe("function");
  });

  it("classifies methods and arrows from their node kind", () => {
    const methodCode = `class Demo {
  run() {
    const value = 1;
    return value;
  }
}`;
    const methodRoot = parse("typescript", methodCode);
    const classNode = methodRoot.child(0);
    const methodNode = classNode?.childByFieldName("body")?.namedChild(0);
    if (!methodNode) throw new Error("Expected method node");

    const methodResult = detectFunctionRegion(methodNode, {
      language: "typescript",
      lineOffset: 0,
      effectiveLines: methodCode.split("\n"),
    });

    expect(methodResult?.type).toBe("method");
  });
});
