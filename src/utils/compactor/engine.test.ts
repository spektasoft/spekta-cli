import { describe, expect, it } from "vitest";
import { extractCollapseRegions, resolveLanguage } from "./engine";

describe("resolveLanguage", () => {
  it("resolves typescript and javascript extensions", () => {
    expect(resolveLanguage("foo.ts")).toBe("typescript");
    expect(resolveLanguage("bar.js")).toBe("javascript");
    expect(resolveLanguage("view.tsx")).toBe("tsx");
  });

  it("resolves php and blade extensions", () => {
    expect(resolveLanguage("Export.php")).toBe("php");
    expect(resolveLanguage("card.blade.php")).toBe("php");
  });

  it("throws a hard error on unsupported extensions", () => {
    expect(() => resolveLanguage("unknown.xyz")).toThrowError(
      'Tree-sitter compaction failed: unsupported file extension for "unknown.xyz"',
    );
  });
});

describe("extractCollapseRegions", () => {
  it("extracts function body bounds correctly", () => {
    const code = `function calculate() {\n  const x = 1;\n  return x;\n}`;
    const regions = extractCollapseRegions("calc.ts", code);
    expect(regions.length).toBeGreaterThan(0);
    expect(regions[0].type).toBe("function");
    expect(regions[0].openLine).toBe(0);
    expect(regions[0].closeLine).toBe(3);
  });

  it("extracts PHP methods correctly without open tag prefix", () => {
    const code = `class Demo {\n  public function run() {\n    return 42;\n  }\n}`;
    const regions = extractCollapseRegions("Demo.php", code);
    expect(regions.length).toBeGreaterThan(0);
    expect(regions[0].type).toBe("method");
    expect(regions[0].openLine).toBe(1);
    expect(regions[0].closeLine).toBe(3);
  });

  it("throws a hard error if parser encounters fatal configuration", () => {
    expect(() => extractCollapseRegions("unsupported.bin", "")).toThrow();
  });
});
