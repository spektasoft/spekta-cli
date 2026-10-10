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

describe("original read content through CLI and MCP", () => {
  it("retains complete original results for an eligible batch", async () => {
    await fs.writeFile(
      path.join(fixture.root, "another.ts"),
      "export const evidence = 42;\n",
    );
    const paths = ["real.txt", "another.ts"];
    const output = await cli(paths);
    expect(output).toContain("needle INTERNAL\nsecond line");
    expect(output).toContain("export const evidence = 42;");
    const response = await createToolRegistry({
      root: fixture.root,
    }).spekta_read.handler({ paths });
    expect(response.content[0].text).toBe(output);
    expect(response.isError).toBeUndefined();
  });

  it("withholds batch contents when another operand is unavailable", async () => {
    const output = await cli(["real.txt", "../sibling.txt"]);
    expect(process.exitCode).toBe(1);
    expect(output).toContain("Operand 2");
    expect(output).not.toContain("INTERNAL");
    expect(output).not.toContain("sibling.txt");
  });
});
