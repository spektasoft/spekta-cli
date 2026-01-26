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
