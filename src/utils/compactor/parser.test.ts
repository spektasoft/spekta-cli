import { describe, expect, it } from "vitest";
import { getOrCreateParser, resolveLanguage } from "./parser";

describe("Compactor Parser Language Resolution", () => {
  it("resolves TypeScript extensions correctly", () => {
    expect(resolveLanguage("file.ts")).toBe("typescript");
    expect(resolveLanguage("file.mts")).toBe("typescript");
  });

  it("resolves Blade and PHP extensions correctly", () => {
    expect(resolveLanguage("template.blade.php")).toBe("php");
    expect(resolveLanguage("index.php")).toBe("php");
  });

  it("throws an error for unsupported extensions", () => {
    expect(() => resolveLanguage("unknown.rs")).toThrow(
      'Tree-sitter compaction failed: unsupported file extension for "unknown.rs"',
    );
  });

  it("retrieves and caches tree-sitter parsers", () => {
    const tsParserFirst = getOrCreateParser("typescript");
    expect(tsParserFirst).toBeDefined();
    expect(typeof tsParserFirst.parse).toBe("function");

    const tsParserSecond = getOrCreateParser("typescript");
    expect(tsParserSecond).toBe(tsParserFirst);

    const jsonParser = getOrCreateParser("json");
    expect(jsonParser).toBeDefined();
    expect(typeof jsonParser.parse).toBe("function");
    expect(jsonParser).not.toBe(tsParserFirst);
  });
});
