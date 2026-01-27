import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeTool, ToolCall } from "../utils/agent-utils";

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

  it("rejects overlapping blocks", async () => {
    const fileName = "overlap.ts";
    await fs.writeFile(fileName, "line1\nline2\nline3");

    const toolCall: ToolCall = {
      type: "replace",
      path: fileName,
      content: `
<<<<<<< SEARCH
line2
=======
updated2
>>>>>>> REPLACE
<<<<<<< SEARCH
line2
=======
updated2-again
>>>>>>> REPLACE`,
      raw: JSON.stringify({
        type: "replace",
        path: fileName,
        content:
          "<<<<<<< SEARCH\nline2\n=======\nupdated2\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nline2\n=======\nupdated2-again\n>>>>>>> REPLACE",
      }),
    };

    await expect(executeTool(toolCall)).rejects.toThrow(/Overlapping/);
  });

  it("rejects excessive block count (>50)", async () => {
    const fileName = "excessive-blocks.txt";
    await fs.writeFile(fileName, "a\na\na");

    // Create content with 51 blocks
    const blocks = Array.from({ length: 51 }, (_, i) => ({
      search: "a",
      replace: `b${i}`,
    }));

    // Build the content string manually since we're testing the integration path
    let content = "";
    for (const block of blocks) {
      content += `
<<<<<<< SEARCH
${block.search}
=======
${block.replace}
>>>>>>> REPLACE
`;
    }

    const toolCall: ToolCall = {
      type: "replace",
      path: fileName,
      content,
      raw: JSON.stringify({
        type: "replace",
        path: fileName,
        content,
      }),
    };

    await expect(executeTool(toolCall)).rejects.toThrow(
      /Too many replacement blocks/,
    );
  });
});
