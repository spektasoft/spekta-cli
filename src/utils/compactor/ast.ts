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
export const CONTAINER_NODE_KINDS = new Set([
  "class_declaration",
  "interface_declaration",
  "trait_declaration",
  "enum_declaration",
  "class",
]);

export function findBodyNode(node: any): any {
  const byField = node.childByFieldName("body");
  if (byField) {
    return byField;
  }
  for (let i = 0; i < node.childCount(); i++) {
    const child = node.child(i);
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

export function findCallbackNode(argsNode: any): any {
  for (let i = 0; i < argsNode.childCount(); i++) {
    const child = argsNode.child(i);
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
