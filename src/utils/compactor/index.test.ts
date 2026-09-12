import { describe, expect, it } from "vitest";
import { compactFile, TreeSitterCompactor } from "./index";

describe("TreeSitterCompactor.canHandle", () => {
  it("returns true for supported code extensions", () => {
    const compactor = new TreeSitterCompactor();
    expect(compactor.canHandle(".ts")).toBe(true);
    expect(compactor.canHandle(".PY")).toBe(true);
  });

  it("returns false for unsupported extensions like markdown", () => {
    const compactor = new TreeSitterCompactor();
    expect(compactor.canHandle(".md")).toBe(false);
    expect(compactor.canHandle(".markdown")).toBe(false);
  });
});

describe("compactFile", () => {
  it("fails open and returns raw content unchanged for markdown files", () => {
    const content = "# Title\n\nSome body text.\n";
    const result = compactFile("README.md", content, 1);
    expect(result.isCompacted).toBe(false);
    expect(result.content).toBe(content);
  });

  it("still compacts supported extensions like typescript", () => {
    const content = `function calculate() {\n  const x = 1;\n  return x;\n}`;
    const result = compactFile("calc.ts", content, 1);
    expect(result.isCompacted).toBe(true);
  });
});
