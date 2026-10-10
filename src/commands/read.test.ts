import fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../__tests__/workspace-fixture";
import { dispatchCommand } from "../cli/commands";
import { createToolRegistry } from "../api/mcp-server/registry";

let fixture: WorkspaceFixture;
let exitCode: typeof process.exitCode;
beforeEach(async () => {
  exitCode = process.exitCode;
  fixture = await createWorkspaceFixture();
  process.chdir(fixture.root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.cleanup();
  process.exitCode = exitCode;
});
async function cli(args: string[]) {
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  await dispatchCommand("read", args);
  return output;
}

describe("public read operands", () => {
  it.each([
    ["[2,3]", "second line\nthird line", "lines 2-3 of 3"],
    ["[2,$]", "second line\nthird line", "lines 2-3 of 3"],
    ["[2]", "second line\nthird line", "lines 2-3 of 3"],
    ["[,2]", "first line\nsecond line", "lines 1-2 of 3"],
    ["[]", "first line\nsecond line\nthird line", "lines 1-3 of 3"],
  ])(
    "preserves %s range grammar over CLI and MCP",
    async (range, content, coverage) => {
      await fs.writeFile(
        path.join(fixture.root, "range.txt"),
        "first line\nsecond line\nthird line\n",
      );
      const operand = `range.txt${range}`;
      const output = await cli([operand]);
      expect(output).toContain(content);
      expect(output).toContain(coverage);
      const response = await createToolRegistry({
        root: fixture.root,
      }).spekta_read.handler({ paths: [operand] });
      expect(response.content[0].text).toBe(output);
      expect(response.isError).toBeUndefined();
    },
  );

  it("preserves literal spaces, brackets and dash-prefixed filenames", async () => {
    for (const name of [
      "notes with spaces.txt",
      "notes[draft].txt",
      "--help",
    ]) {
      await fs.writeFile(path.join(fixture.root, name), "literal evidence\n");
      expect(await cli([`./${name}`])).toContain("literal evidence");
    }
  });

  it("rejects batches whose outcome metadata cannot fit", async () => {
    process.env.SPEKTA_READ_TOKEN_LIMIT = "160";
    await fs.writeFile(
      path.join(fixture.root, "large.txt"),
      "long batch evidence line\n".repeat(100),
    );
    const response = await createToolRegistry({
      root: fixture.root,
    }).spekta_read.handler({ paths: ["real.txt", "large.txt"] });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("output_limit_exceeded");
    expect(response.content[0].text).toMatch(/split/i);
    expect(response.content[0].text).not.toContain("batch evidence");
    expect(response.content[0].text).not.toContain("####");
  });
});
