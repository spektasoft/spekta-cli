import { describe, it, expect } from "vitest";
import { compactFile } from "./compactor";

describe("compactFile", () => {
  it("should compact a simple typescript function", () => {
    const content = `
export function test() {
  console.log("1");
  console.log("2");
  console.log("3");
  console.log("4");
  console.log("5");
}
`.trim();
    const result = compactFile("test.ts", content);
    expect(result.isCompacted).toBe(true);
    expect(result.content).toContain("// ... [lines 2-6 collapsed]");
  });

  it("should not compact a small function", () => {
    const content = `
function small() {
  console.log("1");
}
`.trim();
    const result = compactFile("test.ts", content);
    expect(result.isCompacted).toBe(false);
    expect(result.content).toBe(content);
  });

  it("should handle nested braces", () => {
    const content = `
class MyClass {
  method() {
    if (true) {
      console.log("nested");
    }
  }
  other() {
    console.log("other");
  }
}
`.trim();
    const result = compactFile("test.ts", content);
    expect(result.isCompacted).toBe(true);
    // It should collapse MyClass since it's large enough (8 lines between braces)
    expect(result.content).toContain("// ... [lines 2-9 collapsed]");
  });

  it("should handle absolute line numbering correctly when offset is provided", () => {
    const content = `function test() {\n  console.log(1);\n  console.log(2);\n}`;
    const result = compactFile("test.ts", content, 100);

    // Line 100: function test() {
    // Line 101:   console.log(1);
    // Line 102:   console.log(2);
    // Line 103: }
    // Collapsed: 101-102
    expect(result.content).toContain("lines 101-102");
  });

  it("should collapse nested blocks aggressively", () => {
    const content = `if (true) {\n  if (false) {\n    console.log(1);\n    console.log(2);\n  }\n}`;
    const result = compactFile("test.ts", content, 1);
    // Should collapse the outer if block
    expect(result.content).toContain("lines 2-5");
  });

  it("should return isCompacted=true even when replacement comment is longer than original", () => {
    const content = `function test() {
  console.log("line1");
  console.log("line2");
  console.log("line3");
}`;
    const result = compactFile("test.ts", content);
    // Even though we're replacing multiple lines with a potentially longer comment, isCompacted should be true
    expect(result.isCompacted).toBe(true);
  });

  it("should not compact lines that contain string literals ending with brace", () => {
    const content = `const x = "{";
console.log("This should not be treated as a code block");`;
    const result = compactFile("test.ts", content);
    // The line with string literal should not trigger compaction
    expect(result.content).toBe(content);
    expect(result.isCompacted).toBe(false);
  });
});
