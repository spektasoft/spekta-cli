import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { TOOL_REGISTRY } from "../api/mcp-server/registry";
import { refreshPaths } from "../core/config/paths";
import { runRead } from "./read";
import { runReplace } from "./replace";
import { runWrite } from "./write";

const block = (search: string, replacement: string) =>
  `<<<<<<< SEARCH\n${search}\n=======\n${replacement}\n>>>>>>> REPLACE`;

describe("replace handler integration", { concurrent: false }, () => {
  let root = "";
  let originalCwd = "";
  let originalExitCode: typeof process.exitCode;
  let originalHome: string | undefined;
  let originalAssets: string | undefined;
  let stdout: MockInstance<typeof process.stdout.write>;

  beforeEach(async () => {
    originalCwd = process.cwd();
    originalExitCode = process.exitCode;
    originalHome = process.env.SPEKTA_HOME_OVERRIDE;
    originalAssets = process.env.SPEKTA_ASSET_ROOT_OVERRIDE;
    root = await fs.mkdtemp(path.join(os.tmpdir(), "spekta-replace-"));
    process.chdir(root);
    const configRoot = path.join(root, "config");
    process.env.SPEKTA_HOME_OVERRIDE = path.join(configRoot, "home");
    process.env.SPEKTA_ASSET_ROOT_OVERRIDE = path.join(configRoot, "assets");
    await fs.ensureDir(path.join(configRoot, "assets", "templates"));
    await fs.writeFile(
      path.join(configRoot, "assets", "templates", "default.ignore"),
      "",
    );
    await fs.ensureDir(path.join(configRoot, "home"));
    await fs.writeFile(path.join(configRoot, "home", ".spektaignore"), "");
    refreshPaths();
    await execa("git", ["init", "-q"]);
    await fs.writeFile("control.txt", "control original\n");
    await execa("git", ["add", "control.txt"]);
    await execa("git", [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-qm",
      "fixture",
    ]);
    await fs.writeFile("control.txt", "staged baseline\n");
    await execa("git", ["add", "control.txt"]);
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    stdout.mockRestore();
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    if (originalHome === undefined) delete process.env.SPEKTA_HOME_OVERRIDE;
    else process.env.SPEKTA_HOME_OVERRIDE = originalHome;
    if (originalAssets === undefined)
      delete process.env.SPEKTA_ASSET_ROOT_OVERRIDE;
    else process.env.SPEKTA_ASSET_ROOT_OVERRIDE = originalAssets;
    refreshPaths();
    await fs.remove(root);
    vi.restoreAllMocks();
  });

  const indexSnapshot = async () => ({
    bytes: await fs.readFile(".git/index"),
    stage: (await execa("git", ["ls-files", "--stage"])).stdout,
  });

  it("supports the CLI create, read, and replace workflow before staging", async () => {
    const beforeIndex = await indexSnapshot();
    const original = "first line\nreplace me\nlast line\n";
    const expected = "first line\nreplaced line\nlast line\n";
    await runWrite(["nested/cli.md", original]);
    expect(await fs.readFile("nested/cli.md", "utf-8")).toBe(original);
    await runRead([{ path: "nested/cli.md" }]);
    expect(stdout.mock.calls.flat().join("")).toContain("replace me");
    await runReplace(["nested/cli.md", block("replace me", "replaced line")]);
    expect(await fs.readFile("nested/cli.md", "utf-8")).toBe(expected);
    await runRead([{ path: "nested/cli.md" }]);
    expect(stdout.mock.calls.flat().join("")).toContain("replaced line");
    expect(await indexSnapshot()).toEqual(beforeIndex);
    expect(
      (await execa("git", ["ls-files", "--others", "--exclude-standard"]))
        .stdout,
    ).toContain("nested/cli.md");
  });

  it("supports the MCP create, read, and replace workflow before staging", async () => {
    const beforeIndex = await indexSnapshot();
    const original = "alpha\nold value\nomega\n";
    const expected = "alpha\nnew value\nomega\n";
    const write = await TOOL_REGISTRY.spekta_write.handler({
      path: "nested/mcp.md",
      content: original,
    });
    expect(write.content[0].text).toContain("Successfully created");
    const read = await TOOL_REGISTRY.spekta_read.handler({
      paths: ["nested/mcp.md"],
    });
    expect(read.content[0].text).toContain("old value");
    await TOOL_REGISTRY.spekta_replace.handler({
      path: "nested/mcp.md",
      blocks: block("old value", "new value"),
    });
    expect(await fs.readFile("nested/mcp.md", "utf-8")).toBe(expected);
    const reread = await TOOL_REGISTRY.spekta_read.handler({
      paths: ["nested/mcp.md"],
    });
    expect(reread.content[0].text).toContain("new value");
    expect(await indexSnapshot()).toEqual(beforeIndex);
    expect(
      (await execa("git", ["ls-files", "--others", "--exclude-standard"]))
        .stdout,
    ).toContain("nested/mcp.md");
  });

  it("reports a saved MCP replacement when Prettier cannot parse the result", async () => {
    const initial = "const value = 1;\n";
    await fs.writeFile("invalid.ts", initial);

    const result = await TOOL_REGISTRY.spekta_replace.handler({
      path: "invalid.ts",
      blocks: block(initial.trimEnd(), "const value = ;"),
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(
      "Replaced 1 block(s) in invalid.ts",
    );
    expect(result.content[0].text).toContain(
      'Content was saved to "invalid.ts"',
    );
    expect(result.content[0].text).toContain(
      "Retrying the mutation is unnecessary.",
    );
    expect(result.content[0].text).not.toContain("SyntaxError");
    expect(result.content[0].text).not.toContain("Unexpected token");
    expect(await fs.readFile("invalid.ts", "utf-8")).toBe("const value = ;\n");
  });

  it("returns MCP error envelopes for replacement failures before saving", async () => {
    await fs.writeFile(".env", "secret=fixture\n");

    const result = await TOOL_REGISTRY.spekta_replace.handler({
      path: ".env",
      blocks: block("secret=fixture", "changed"),
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("restricted system file");
    expect(result.content[0].text).not.toContain(".env");
    expect(result.content[0].text).not.toContain("secret=fixture");
    expect(result.content[0].text).not.toContain("Content was saved");
    expect(await fs.readFile(".env", "utf-8")).toBe("secret=fixture\n");
  });

  it("replaces an eligible tracked file without changing staged index state", async () => {
    await fs.writeFile("tracked.md", "old tracked value\n");
    await execa("git", ["add", "tracked.md"]);
    const beforeIndex = await indexSnapshot();
    await TOOL_REGISTRY.spekta_replace.handler({
      path: "tracked.md",
      blocks: block("old tracked value", "new tracked value"),
    });
    expect(await fs.readFile("tracked.md", "utf-8")).toBe(
      "new tracked value\n",
    );
    expect(await indexSnapshot()).toEqual(beforeIndex);
  });

  it("rejects a Git-ignored tracked replacement target without changing it or the index", async () => {
    await fs.writeFile(".gitignore", "ignored.md\n");
    await fs.writeFile("ignored.md", "preserve this\n");
    await execa("git", ["add", ".gitignore"]);
    await execa("git", ["add", "-f", "ignored.md"]);
    const beforeIndex = await indexSnapshot();
    const result = await TOOL_REGISTRY.spekta_replace.handler({
      path: "ignored.md",
      blocks: block("preserve this", "changed"),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("ignored by git");
    expect(result.content[0].text).not.toContain("Content was saved");
    expect(await fs.readFile("ignored.md", "utf-8")).toBe("preserve this\n");
    expect(await indexSnapshot()).toEqual(beforeIndex);
  });

  it("rejects restricted files and preserves content", async () => {
    await fs.writeFile(".env", "secret=fixture\n");
    const beforeIndex = await indexSnapshot();
    const result = await TOOL_REGISTRY.spekta_replace.handler({
      path: ".env",
      blocks: block("secret=fixture", "changed"),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("restricted system file");
    expect(result.content[0].text).not.toContain("Content was saved");
    expect(await fs.readFile(".env", "utf-8")).toBe("secret=fixture\n");
    expect(await indexSnapshot()).toEqual(beforeIndex);
  });

  it("preserves the whole file when a later search block is missing", async () => {
    const initial = "first target\nsecond target\n";
    await fs.writeFile("multi.md", initial);
    const result = await TOOL_REGISTRY.spekta_replace.handler({
      path: "multi.md",
      blocks: `${block("first target", "changed first")}\n${block("absent", "changed absent")}`,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("could not be found");
    expect(result.content[0].text).not.toContain("Content was saved");
    expect(await fs.readFile("multi.md", "utf-8")).toBe(initial);
  });
});
