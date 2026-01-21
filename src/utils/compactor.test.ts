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
    expect(result.content).toContain("// ... [5 lines collapsed]");
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
    expect(result.content).toContain("// ... [8 lines collapsed]");
  });
});
