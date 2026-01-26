import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import fs from "fs-extra";
import path from "path";
import { ToolCall } from "../utils/agent-utils";
import { executeTool } from "../utils/agent-utils";

// Mock security at the module level for integration tests
vi.mock("../utils/security", () => ({
  validateEditAccess: vi.fn().mockResolvedValue(undefined),
  validatePathAccess: vi.fn().mockResolvedValue(undefined),
  validatePathAccessForWrite: vi.fn().mockResolvedValue(undefined),
}));

describe("Replace tool minimal output integration", () => {
  const workspace = "test-workspace-minimal";
  const originalCwd = process.cwd();

  beforeEach(async () => {
    await fs.ensureDir(workspace);
    process.chdir(workspace);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.remove(workspace);
    vi.clearAllMocks();
  });

  it("agent receives minimal summary without token-bloating context", async () => {
    const fileName = "large-file.ts";
    const initialContent = Array.from(
      { length: 50 },
      (_, i) => `line ${i + 1}`,
    ).join("\n");
    await fs.writeFile(fileName, initialContent);

    const toolCall: ToolCall = {
      type: "replace",
      path: fileName,
      content: `<<<<<<< SEARCH
line 25
=======
updated line 25
>>>>>>> REPLACE`,
      raw: JSON.stringify({
        type: "replace",
        path: fileName,
        content:
          "<<<<<<< SEARCH\nline 25\n=======\nupdated line 25\n>>>>>>> REPLACE",
      }),
    };

    const result = await executeTool(toolCall);

    // Verify minimal output characteristics
    expect(result).toMatch(/Replaced 1 block\(s\) in large-file\.ts/);
    expect(result).toMatch(/Line ranges: 25-25/);

    // Verify NO verbose context snippets or headers
    expect(result).not.toMatch(/####/);
    expect(result).not.toMatch(/Updated Context:/);
    expect(result).not.toMatch(/```/);

    // Verify actual file was modified correctly
    const updated = await fs.readFile(fileName, "utf-8");
    expect(updated).toContain("updated line 25");
    expect(updated.split(/\r?\n/).length).toBe(50);
  });
});
