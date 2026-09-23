export const TEST_CALL_NAMES = new Set([
  "it",
  "test",
  "beforeEach",
  "afterEach",
  "beforeAll",
  "afterAll",
]);

export const TEST_SUITE_NAMES = new Set(["describe", "context"]);

export const FUNCTION_NODE_KINDS = new Set([
  "function_declaration",
  "function_definition",
  "method_declaration",
  "method_definition",
  "arrow_function",
  "function_expression",
  "anonymous_function",
  "generator_function_declaration",
  "generator_function",
]);

// Note: Kotlin has no dedicated "interface_declaration" node kind. Kotlin
// interfaces parse as "class_declaration" with an "interface" keyword token,
// so they are already covered by that entry below; do not add a
// Kotlin-specific interface kind here.
import type { Node } from "@xberg-io/tree-sitter-language-pack";

export interface AstNodeLike {
  kind(): string;
  childCount?(): number;
  child?(index: number): AstNodeLike | null;
  childByFieldName?(field: string): AstNodeLike | null;
}

export const CONTAINER_NODE_KINDS = new Set([
  "class_declaration",
  "interface_declaration",
  "trait_declaration",
  "enum_declaration",
  "class",
  // Python's class node kind. Python has no dedicated interface/trait kind,
  // so only this entry is needed for Python container recursion.
  "class_definition",
]);

export function findBodyNode(node: Node | null): Node | null;
export function findBodyNode(node: AstNodeLike | null): AstNodeLike | null;
export function findBodyNode(
  node: AstNodeLike | Node | null,
): AstNodeLike | Node | null {
  if (!node) {
    return null;
  }
  const byField = node.childByFieldName?.("body");
  if (byField) {
    return byField;
  }
  const count = node.childCount ? node.childCount() : 0;
  for (let i = 0; i < count; i++) {
    const child = node.child ? node.child(i) : null;
    if (!child) continue;
    const kind = child.kind();
    if (
      kind === "statement_block" ||
      kind === "compound_statement" ||
      kind === "block" ||
      kind === "function_body"
    ) {
      return child;
    }
  }
  return null;
}

export function findCallbackNode(argsNode: Node | null): Node | null;
export function findCallbackNode(
  argsNode: AstNodeLike | null,
): AstNodeLike | null;
export function findCallbackNode(
  argsNode: AstNodeLike | Node | null,
): AstNodeLike | Node | null {
  if (!argsNode) {
    return null;
  }
  const count = argsNode.childCount ? argsNode.childCount() : 0;
  for (let i = 0; i < count; i++) {
    const child = argsNode.child ? argsNode.child(i) : null;
    if (!child) continue;
    const kind = child.kind();
    if (
      kind === "arrow_function" ||
      kind === "function_expression" ||
      kind === "function_declaration" ||
      kind === "anonymous_function"
    ) {
      return child;
    }
  }
  return null;
}
