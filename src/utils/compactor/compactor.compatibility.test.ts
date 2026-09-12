import { describe, expect, it } from "vitest";
import { compactFile, TreeSitterCompactor } from "./index";

describe("dynamic language compatibility tier", () => {
  it("canHandle returns true for a pack-supported extension not previously in the static map", () => {
    const compactor = new TreeSitterCompactor();
    expect(compactor.canHandle(".kt")).toBe(true);
  });

  it("canHandle returns false for an extension the pack does not recognize", () => {
    const compactor = new TreeSitterCompactor();
    expect(compactor.canHandle(".xyz")).toBe(false);
  });

  it("compactFile returns a warning and skips compaction for a resolvable but unverified language", () => {
    const content = "fn main() {}\n";
    const result = compactFile("main.rs", content, 1);
    expect(result.isCompacted).toBe(false);
    expect(result.content).toBe(content);
    expect(result.warning).toMatch(/not yet verified/);
  });

  it("compactFile still fully compacts a verified language such as Kotlin", () => {
    const content = `fun greet() {\n  println("hi")\n}\n`;
    const result = compactFile("Greeter.kt", content, 1);
    expect(result.warning).toBeUndefined();
  });

  it("compactFile returns a warning and skips compaction for a markup language with no function/container nodes", () => {
    const content = ".foo {\n  color: red;\n}\n";
    const result = compactFile("styles.css", content, 1);
    expect(result.isCompacted).toBe(false);
    expect(result.content).toBe(content);
    expect(result.warning).toMatch(/not yet verified/);
  });
});
