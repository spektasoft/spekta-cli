import { describe, expect, it } from "vitest";
import { getGlobalPromptContext, getSafeGitDiff } from "./context";

describe("Safe Global Context", () => {
  it("should return safe global context including id, cwd, and timestamp", () => {
    const ctx = getGlobalPromptContext({ customVar: "test" });
    expect(ctx.cwd).toBe(process.cwd());
    expect(ctx.timestamp).toBeTypeOf("string");
    expect(ctx.customVar).toBe("test");
    expect(ctx.git_diff).toBeTypeOf("string");
    expect(ctx.id).toBeTypeOf("string");
    expect(ctx.id.length).toBeGreaterThan(0);
  });

  it("should safely retrieve git diff without throwing on error", () => {
    const diff = getSafeGitDiff();
    expect(typeof diff).toBe("string");
  });
});
