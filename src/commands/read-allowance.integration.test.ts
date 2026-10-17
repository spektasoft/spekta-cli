import fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToolRegistry } from "../api/mcp-server/registry";
import { dispatchCommand } from "../cli/commands";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../__tests__/workspace-fixture";
import { getTokenCount } from "../utils/read-utils";

const KEYS = ["SPEKTA_READ_TOKEN_LIMIT", "SPEKTA_READ_TOKEN_CEILING"];
let saved: Record<string, string | undefined>;
let fixture: WorkspaceFixture;
let initialExitCode: typeof process.exitCode;

beforeEach(async () => {
  initialExitCode = process.exitCode;
  process.exitCode = undefined;
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  fixture = await createWorkspaceFixture();
  process.chdir(fixture.root);
  await fs.writeFile(
    path.join(fixture.root, "big.txt"),
    Array.from(
      { length: 200 },
      (_, i) => `allowance evidence line ${i + 1}`,
    ).join("\n"),
  );
  await fs.writeFile(path.join(fixture.root, "small.txt"), "tiny evidence\n");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.cleanup();
  process.exitCode = initialExitCode;
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

async function mcp(allowance?: unknown, pathName = "big.txt") {
  return createToolRegistry({ root: fixture.root }).spekta_read.handler(
    { paths: [pathName], ...(allowance === undefined ? {} : { allowance }) },
    undefined,
    "allowance",
  );
}

async function cli(args: string[]) {
  let output = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
  await dispatchCommand("read", args);
  return output;
}

describe("read allowances at CLI and MCP boundaries", () => {
  it("keeps the configured default and honors smaller and larger requests", async () => {
    expect((await mcp()).isError).toBe(true);
    const raised = await mcp(6000);
    expect(raised.isError).toBeUndefined();
    expect(raised.content[0].text).toContain("evidence line 200");
    expect(
      getTokenCount(await cli(["big.txt", "--allowance=6000"])),
    ).toBeLessThanOrEqual(6000);
    expect(
      getTokenCount(await cli(["big.txt", "--allowance", "300"])),
    ).toBeLessThanOrEqual(300);
  });

  it("rejects invalid and over-ceiling values and permits the default when ceiling is lower", async () => {
    process.env.SPEKTA_READ_TOKEN_CEILING = "2000";
    expect((await mcp(2001)).content[0].text).toContain("ceiling");
    expect((await mcp(0)).content[0].text).toContain("usage_error");
    process.env.SPEKTA_READ_TOKEN_CEILING = "50";
    expect((await mcp(1000, "small.txt")).isError).toBeUndefined();
  });

  it("uses the fallback ceiling for invalid configuration", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.SPEKTA_READ_TOKEN_CEILING = "invalid";
    expect((await mcp(8000, "small.txt")).isError).toBeUndefined();
    expect((await mcp(8001, "small.txt")).isError).toBe(true);
  });
});
