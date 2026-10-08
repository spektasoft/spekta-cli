import fs from "fs-extra";
import path from "path";
import { execa } from "execa";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runRtkProxy } from "./proxy";
import { TOOL_REGISTRY } from "../../api/mcp-server/registry";
import { createProxyFixture } from "./proxy-mocked.integration-fixture";

vi.mock("execa", () => ({ execa: vi.fn() }));
const fixture = createProxyFixture({
  prefix: "spekta-find-disclosure-",
  stdout: "",
});
let workspace: string;
beforeEach(() => {
  ({ workspace } = fixture.setup());
  fs.writeFileSync(path.join(workspace, "visible.ts"), "ok");
});
afterEach(() => fixture.teardown());

async function discover(stdout: string, args: string[] = []) {
  vi.mocked(execa).mockImplementation(((command: string) => {
    if (command === "git") throw new Error("not ignored");
    return Promise.resolve({ stdout, stderr: "", exitCode: 0 });
  }) as never);
  await runRtkProxy("find", args);
  const mcp = await TOOL_REGISTRY.spekta_shell.handler({
    command: "find",
    args,
  });
  return { cli: vi.mocked(console.log).mock.calls.flat().join("\n"), mcp };
}

it("discloses only eligible descendants through CLI and MCP", async () => {
  const result = await discover(
    ".\n./visible.ts\n./.env\n./restricted-alias\n./escape\n./dangling",
  );
  expect(result.cli).toContain("./visible.ts");
  expect(JSON.stringify(result)).not.toMatch(
    /\.env|restricted-alias|escape|dangling/,
  );
  expect(result.mcp).toEqual({
    isError: false,
    content: [{ type: "text", text: ".\n./visible.ts" }],
  });
});

it("withholds child failure output and preserves status", async () => {
  vi.mocked(execa).mockResolvedValue({
    stdout: "./.env",
    stderr: "cannot read restricted-alias",
    exitCode: 7,
  } as never);
  await runRtkProxy("find", []);
  const mcp = await TOOL_REGISTRY.spekta_shell.handler({ command: "find" });
  expect(process.exitCode).toBe(7);
  expect(mcp).toEqual({
    isError: true,
    content: [{ type: "text", text: "RTK command failed with exit status 7." }],
  });
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(
    /\.env|restricted-alias/,
  );
  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining("[FAILED: Exit 7]"),
  );
  expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toMatch(
    /\.env|restricted-alias|cannot read restricted-alias/,
  );
}, 15000);

it("bounds the complete response using only eligible results", async () => {
  const names = Array.from(
    { length: 300 },
    (_, i) => `visible-long-name-${i}.ts`,
  );
  for (const name of names) fs.writeFileSync(path.join(workspace, name), "ok");
  const { cli, mcp } = await discover(
    names.map((name) => `./${name}`).join("\n"),
  );
  const { getTokenCount } = await import("../../utils/read-utils");
  expect(getTokenCount(`${cli}\n`)).toBeLessThanOrEqual(1000);
  expect(getTokenCount(JSON.stringify(mcp))).toBeLessThanOrEqual(1000);
  expect(cli).toContain("TRUNCATED");
});

it("filters ignored ancestors and ineligible aliases under nested roots", async () => {
  fs.ensureDirSync(path.join(workspace, "directory", "ignored"));
  fs.writeFileSync(
    path.join(workspace, ".spektaignore"),
    "ignored/\n*.log\n!keep.log\n",
  );
  for (const name of ["ok.ts", "secret.log", "keep.log", "ignored/hidden.ts"]) {
    fs.writeFileSync(path.join(workspace, "directory", name), "ok");
  }
  fs.symlinkSync(
    path.join(workspace, "directory", "secret.log"),
    path.join(workspace, "directory", "alias"),
  );
  const { cli, mcp } = await discover(
    "directory/ok.ts\ndirectory/secret.log\ndirectory/keep.log\ndirectory/ignored\ndirectory/ignored/hidden.ts\ndirectory/alias",
    ["directory", "-type", "f", "-name", "*.ts", "-print"],
  );
  expect(mcp).toEqual({
    isError: false,
    content: [{ type: "text", text: "directory/ok.ts\ndirectory/keep.log" }],
  });
  expect(cli).not.toMatch(/secret|ignored|hidden|alias/);
});

it("does not disclose targets reached through directory symlink descendants", async () => {
  fs.symlinkSync(
    path.join(workspace, "directory"),
    path.join(workspace, "internal-alias"),
    "dir",
  );
  fs.writeFileSync(path.join(workspace, "directory", "child.ts"), "ok");
  const { mcp } = await discover(
    "./internal-alias\n./internal-alias/child.ts\n./visible.ts",
  );
  expect(mcp).toEqual({
    isError: false,
    content: [{ type: "text", text: "./internal-alias\n./visible.ts" }],
  });
});

it("rejects unattributable output without disclosing it", async () => {
  const { mcp } = await discover("../outside/private.ts");
  expect(mcp.isError).toBe(true);
  expect(JSON.stringify(mcp)).not.toContain("private");
});
