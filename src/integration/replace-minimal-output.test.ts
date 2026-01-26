import { describe, it, beforeEach, afterEach, expect } from "vitest";
import fs from "fs-extra";
import { execSync } from "child_process";
import { ToolCall } from "../utils/agent-utils";
import { executeTool } from "../utils/agent-utils";

describe("Replace tool minimal output integration", () => {
  beforeEach(async () => {
    await fs.ensureDir("test-workspace");
    process.chdir("test-workspace");

    // Initialize git repo for the test workspace to pass security validation
    execSync("git init", { stdio: "pipe" });
    execSync("git config user.name 'Test User'", { stdio: "pipe" });
    execSync("git config user.email 'test@example.com'", { stdio: "pipe" });
  });

  afterEach(async () => {
    process.chdir("..");
    await fs.remove("test-workspace");
  });

  it("agent receives minimal summary without token-bloating context", async () => {
    const initialContent = Array.from(
      { length: 50 },
      (_, i) => `line ${i + 1}`,
    ).join("\n");
    await fs.writeFile("large-file.ts", initialContent);

    // Add the file to git tracking
    execSync("git add large-file.ts", { stdio: "pipe" });
    execSync("git commit -m 'Add large-file.ts'", { stdio: "pipe" });

    const toolCall: ToolCall = {
      type: "replace",
      path: "large-file.ts",
      content: `<<<<<<< SEARCH
line 25
=======
updated line 25
>>>>>>> REPLACE`,
      raw: `{
        "type": "replace",
        "path": "large-file.ts",
        "content": "<<<<<<< SEARCH\\nline 25\\n=======\\nupdated line 25\\n>>>>>>> REPLACE"
      }`,
    };

    const result = await executeTool(toolCall);

    // Verify minimal output characteristics
    expect(result).toMatch(/Replaced 1 block\(s\) in large-file\.ts/);
    expect(result).toMatch(/Line ranges: 25-25/);

    // Verify NO verbose context snippets
    expect(result).not.toMatch(/#### large-file\.ts \(lines/);
    expect(result).not.toMatch(/Updated Context:/);
    expect(result).not.toMatch(/```\n/);

    // Verify actual file was modified correctly
    const updated = await fs.readFile("large-file.ts", "utf-8");
    expect(updated).toContain("updated line 25");
    expect(updated.split("\n").length).toBe(50); // Line count preserved
  });
});
