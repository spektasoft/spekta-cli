import { describe, expect, it } from "vitest";
import { renderCompactedContent } from "./renderer";

describe("renderCompactedContent", () => {
  it("returns original content when no regions are provided", () => {
    const lines = ["function test() {", "  return 1;", "}"];
    const result = renderCompactedContent(lines, [], 1);
    expect(result.didCompact).toBe(false);
    expect(result.content).toBe(lines.join("\n"));
  });

  it("substitutes region body with collapsed indicator", () => {
    const lines = ["function test() {", "  const x = 1;", "  return x;", "}"];
    const regions = [{ openLine: 0, closeLine: 3, type: "function" as const }];
    const result = renderCompactedContent(lines, regions, 1);
    expect(result.didCompact).toBe(true);
    expect(result.content).toContain("// ... [lines 2-3 collapsed]");
    expect(result.content).toContain("function test() {");
    expect(result.content).toContain("}");
  });

  it("prioritizes outer regions over nested regions", () => {
    const lines = [
      'it("test", () => {',
      "  function inner() {",
      "    return 2;",
      "  }",
      "});",
    ];
    const regions = [
      { openLine: 0, closeLine: 4, type: "test" as const },
      { openLine: 1, closeLine: 3, type: "function" as const },
    ];
    const result = renderCompactedContent(lines, regions, 1);
    expect(result.didCompact).toBe(true);
    expect(result.content).toContain("// ... [lines 2-4 collapsed]");
    expect(result.content).not.toContain("inner");
  });
});
