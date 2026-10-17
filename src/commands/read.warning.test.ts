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

describe("original reads of formats without structural compaction", () => {
  it("returns original lines without a compaction warning", async () => {
    process.env.SPEKTA_COMPACT_THRESHOLD = "0";
    const source = 'fn main() {\n    println!("original detail");\n}\n';
    await fs.writeFile(path.join(fixture.root, "main.rs"), source);
    const output = await cli(["main.rs"]);
    expect(output).toContain(source);
    expect(output).not.toContain("Compaction skipped");
    expect(output).not.toContain("COMPACTION NOTICE");
    const response = await createToolRegistry({
      root: fixture.root,
    }).spekta_read.handler({ paths: ["main.rs"] });
    expect(response.content[0].text).toBe(output);
  });
});
