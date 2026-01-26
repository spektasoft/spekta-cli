import { describe, expect, it } from "vitest";
import { compactFile } from "./compactor";

describe("compactor pattern recognition", () => {
  it("protects import statements", () => {
    const content = `import { a } from "b";
import { c } from "d";

function test() {
  return 1;
}`;
    const result = compactFile("test.ts", content, 1);
    expect(result.content).toContain("import { a }");
    expect(result.content).toContain("import { c }");
  });

  it("detects test blocks", () => {
    const content = `it("should work", () => {
  expect(1).toBe(1);
});`;
    const result = compactFile("test.test.ts", content, 1);
    expect(result.isCompacted).toBe(true);
    expect(result.content).toContain("// ... [lines");
  });
});

describe("brace matching", () => {
  it("matches nested braces correctly", () => {
    const content = `function outer() {
  function inner() {
    return 1;
  }
  return inner();
}`;
    const result = compactFile("test.ts", content, 1);
    expect(result.isCompacted).toBe(true);
    // Should collapse both inner and outer
    expect((result.content.match(/\[lines/g) || []).length).toBeGreaterThan(0);
  });

  it("handles single-line functions", () => {
    const content = `function short() { return 1; }`;
    const result = compactFile("test.ts", content, 1);
    // Single line should NOT be collapsed
    expect(result.content).toBe(content);
  });
});
