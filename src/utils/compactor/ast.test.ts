import { describe, expect, it } from "vitest";
import {
  findBodyNode,
  findCallbackNode,
  TEST_CALL_NAMES,
  TEST_SUITE_NAMES,
} from "./ast";

describe("AST Classification and Helper Utilities", () => {
  it("identifies test call and test suite names", () => {
    expect(TEST_SUITE_NAMES.has("describe")).toBe(true);
    expect(TEST_SUITE_NAMES.has("context")).toBe(true);
    expect(TEST_CALL_NAMES.has("it")).toBe(true);
    expect(TEST_CALL_NAMES.has("test")).toBe(true);
  });

  it("locates callback nodes from argument children", () => {
    const mockCallback = { kind: () => "arrow_function" };
    const mockArgs = {
      childCount: () => 2,
      child: (i: number) => (i === 0 ? { kind: () => "string" } : mockCallback),
    };
    expect(findCallbackNode(mockArgs)).toBe(mockCallback);
  });

  it("locates body nodes by field or block kind", () => {
    const mockBody = { kind: () => "statement_block" };
    const mockNodeWithField = {
      childByFieldName: (field: string) => (field === "body" ? mockBody : null),
      childCount: () => 0,
      child: () => null,
    };
    expect(findBodyNode(mockNodeWithField)).toBe(mockBody);
  });
});
