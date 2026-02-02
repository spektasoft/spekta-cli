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
  expect(2).toBe(2);
  expect(3).toBe(3);
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

describe("SemanticCompactor", () => {
  it("identifies method declarations correctly", () => {
    const content = `class Test {
  public function save() {
    // implementation
  }
}`;
    const result = compactFile("test.php", content, 1);
    expect(result.content).toContain("public function save()");
    expect(result.content).toContain("// ... [lines");
  });

  it("identifies describe blocks correctly", () => {
    const content = `describe("suite", () => {
  it("test", () => {
    // implementation
  });
});`;
    const result = compactFile("test.ts", content, 1);
    expect(result.content).toContain('describe("suite"');
    expect(result.content).toContain('it("test"');
    expect(result.content).toContain("// ... [lines");
  });

  it("identifies anonymous functions correctly", () => {
    const content = `const callback = function ($item) {
  // implementation
};`;
    const result = compactFile("test.php", content, 1);
    expect(result.content).toContain("function ($item)");
    expect(result.content).toContain("// ... [lines");
  });

  it("collapses test bodies aggressively", () => {
    const content = `describe("suite", () => {
  it("test 1", () => {
    expect(1).toBe(1);
    expect(2).toBe(2);
    expect(3).toBe(3);
  });

  it("test 2", () => {
    const a = 1;
    expect(a).toBe(1);
  });
});`;
    const result = compactFile("test.test.ts", content, 1);
    expect(result.isCompacted).toBe(true);
    expect(result.content).toContain('it("test 1"');
    expect(result.content).toContain("// ... [lines");
    expect(result.content).not.toContain("expect(1).toBe(1)");
  });

  it("preserves describe headers", () => {
    const content = `describe("suite", () => {
  it("test", () => {
    expect(1).toBe(1);
  });
});`;
    const result = compactFile("test.test.ts", content, 1);
    expect(result.content).toContain('describe("suite"');
  });

  it("collapses function bodies", () => {
    const content = `function calculateTotal(items) {
  const sum = items.reduce((a, b) => a + b, 0);
  return sum * 1.1;
}`;
    const result = compactFile("calc.ts", content, 1);
    expect(result.isCompacted).toBe(true);
    expect(result.content).toContain("function calculateTotal");
    expect(result.content).toContain("// ... [lines");
  });

  it("matches PHP traits, interfaces, and enums", () => {
    const content = `trait ExportTrait {}
interface ExportInterface {}
enum Status { ACTIVE, INACTIVE }`;

    const result = compactFile("test.php", content, 1);
    expect(result.content).toContain("trait ExportTrait");
    expect(result.content).toContain("interface ExportInterface");
    expect(result.content).toContain("enum Status");
  });

  it("never collapses class declarations", () => {
    const content = `class MyClass {
  method1() {
    return 1;
  }
}`;
    const result = compactFile("class.ts", content, 1);
    expect(result.content).toContain("class MyClass");
    // Should collapse method, not class
    expect(result.content).toContain("method1()");
  });

  it("supports Allman style bracing (PHP-style)", () => {
    const content = `class Test
{
    public function run()
    {
        // code
    }
}`;
    const result = compactFile("class.ts", content, 1);
    expect(result.content).toContain("class Test");
    // Should collapse method but not class
    expect(result.content).toContain("public function run()");
  });
});

describe("full file compaction", () => {
  it("matches expected output for agent-utils test file", () => {
    const content = `import { beforeEach, describe, expect, it, vi } from "vitest";
import { getReadContent } from "../commands/read";
import {
  executeTool,
  parseToolCalls,
  ToolCall,
  validateFilePath,
} from "./agent-utils";

describe("agent-utils", () => {
  describe("parseToolCalls", () => {
    it("parses tool calls", () => {
      const text = "test";
      const calls = parseToolCalls(text);
      expect(calls).toHaveLength(2);
    });
  });
});`;

    const result = compactFile("agent-utils.test.ts", content, 1);

    // Verify imports are preserved
    expect(result.content).toContain("import { beforeEach");
    expect(result.content).toContain("import { getReadContent");

    // Verify test body is collapsed
    expect(result.content).toContain('it("parses tool calls"');
    expect(result.content).toContain("// ... [lines");
    expect(result.isCompacted).toBe(true);
  });
});

describe("object literal compaction", () => {
  it("collapses object literals in expect statements", () => {
    const content = `it("test", () => {
  expect(result).toEqual({
    type: "read",
    path: "file.ts",
    raw: "data"
  });
});`;
    const result = compactFile("test.test.ts", content, 1);
    expect(result.content).toContain("expect(result).toEqual({");
    expect(result.content).toContain("// ... [lines");
  });
});

describe("edge cases", () => {
  it("preserves single-line arrow functions", () => {
    const content = `const fn = () => { return 1; };`;
    const result = compactFile("test.ts", content, 1);
    expect(result.content).toBe(content);
    expect(result.isCompacted).toBe(false);
  });

  it("handles deeply nested structures", () => {
    const content = `function outer() {
  function middle() {
    function inner() {
      return 1;
    }
    return inner();
  }
  return middle();
}`;
    const result = compactFile("test.ts", content, 1);
    expect(result.isCompacted).toBe(true);
    // Should have multiple collapse markers
    expect(
      (result.content.match(/collapsed/g) || []).length,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("performance and integration", () => {
  it("handles small files efficiently", () => {
    const content = `function small() {\n  return 1;\n}`;
    const start = Date.now();
    const result = compactFile("test.ts", content, 1);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(10); // Should be nearly instant
  });

  it("compacts large files within reasonable time", () => {
    // Generate a large test file
    const tests = Array.from(
      { length: 100 },
      (_, i) =>
        `it("test ${i}", () => {\n  expect(${i}).toBe(${i});\n expect(${i}).toBe(${i}); \n expect(${i}).toBe(${i});});`,
    ).join("\n\n");
    const content = `describe("suite", () => {\n${tests}\n});`;

    const start = Date.now();
    const result = compactFile("large.test.ts", content, 1);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(100); // Should complete quickly
    expect(result.isCompacted).toBe(true);

    // Verify reduction
    const originalLines = content.split("\n").length;
    const compactedLines = result.content.split("\n").length;
    expect(compactedLines).toBeLessThan(originalLines);
  });
});

describe("PHP Compaction", () => {
  it("compacts PHP classes with Allman style braces", () => {
    const content = `<?php
class Export extends FilamentExport
{
    use HasFactory;

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'creator_id');
    }
}`;
    const result = compactFile("Export.php", content, 1);
    expect(result.content).toContain("class Export");
    expect(result.content).toContain("public function creator()");
    expect(result.content).toContain("// ... [lines 8-10 collapsed]");
    expect(result.content).toContain("use HasFactory;");
  });

  it("handles PHP traits and interfaces", () => {
    const content = `trait Loggable
{
    public function log(string $message)
    {
        echo $message;
    }
}`;
    const result = compactFile("Loggable.php", content, 1);
    expect(result.content).toContain("trait Loggable");
    expect(result.content).toContain("// ... [lines 5-5 collapsed]");
  });
});

describe("Regression: TypeScript Compaction", () => {
  it("still compacts TS classes correctly", () => {
    const content = `export class ReplSession {
  constructor() {
    this.setup();
  }
}`;
    const result = compactFile("repl.ts", content, 1);
    expect(result.content).toContain("export class ReplSession");
    expect(result.content).toContain("// ... [lines 3-3 collapsed]");
  });
});
