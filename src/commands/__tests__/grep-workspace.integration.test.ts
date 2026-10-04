import fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../../__tests__/workspace-fixture";
import { getGrepContent } from "../grep-search";
import { getGrepOutcome } from "../grep-search";
import { buildGrepArgs } from "../grep-args-builder";
import { TOOL_REGISTRY } from "../../api/mcp-server/registry";
import * as runner from "execa";

vi.mock("execa", { spy: true });

let fixture: WorkspaceFixture;
beforeEach(async () => {
  fixture = await createWorkspaceFixture();
  vi.mocked(runner.execa).mockClear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.cleanup();
});

describe("workspace searches with real ripgrep", () => {
  it("keeps alias ignores and oversized descendants out of CLI and MCP results", async () => {
    await fs.symlink(fixture.root, path.join(fixture.root, "alias"), "dir");
    await fs.writeFile(
      path.join(fixture.root, ".spektaignore"),
      "alias/secret.txt\n!allowed.txt\n",
    );
    await fs.writeFile(
      path.join(fixture.root, "secret.txt"),
      "needle ALIAS_IGNORED_CONTENT\n",
    );
    await fs.writeFile(
      path.join(fixture.root, "too-large-secret.txt"),
      `needle OVERSIZED_CONTENT ${"x".repeat(10 * 1024 * 1024)}`,
    );

    const cli = await getGrepOutcome(
      { pattern: "needle", path: "alias" },
      { root: fixture.root },
    );
    const mcp = await TOOL_REGISTRY.spekta_grep.handler(
      { pattern: "needle", path: "alias" },
      { root: fixture.root },
      1,
    );

    const cliText = cli.status === "success" ? cli.value : cli.message;
    const mcpText = mcp.content[0]?.text ?? "";
    for (const text of [cliText, mcpText]) {
      expect(text).toContain("INTERNAL");
      expect(text).not.toMatch(
        /secret\.txt|ALIAS_IGNORED_CONTENT|too-large-secret|OVERSIZED_CONTENT|OVERSIZED_CONTENT/,
      );
    }
    expect(mcp.isError).toBeUndefined();
    expect(mcpText).toContain("INTERNAL");
  });

  it.each([
    "../sibling.txt",
    "external-file.txt",
    "external-dir",
    "hop/missing/deep.txt",
    "dangling.txt",
    "cycle-a",
    "missing.txt",
    "alias.env.txt",
    "ignored-alias.txt",
  ])("rejects invalid root %s before spawning", async (target) => {
    await expect(
      getGrepContent(
        { pattern: "needle", path: target },
        { root: fixture.root },
      ),
    ).rejects.toThrow();
    expect(
      vi
        .mocked(runner.execa)
        .mock.calls.filter(([command]) => command === "rg"),
    ).toHaveLength(0);
  });
  it("denies external and oversized file roots", async () => {
    await expect(
      getGrepContent(
        { pattern: "needle", path: path.join(fixture.outside, "secret.txt") },
        { root: fixture.root },
      ),
    ).rejects.toThrow("outside");
    const handle = await fs.open(path.join(fixture.root, "huge.txt"), "w");
    try {
      await fs.ftruncate(handle, 10 * 1024 * 1024 + 1);
    } finally {
      await fs.close(handle);
    }
    await expect(
      getGrepContent(
        { pattern: "needle", path: "huge.txt" },
        { root: fixture.root },
      ),
    ).rejects.toThrow("size limit");
  });
  it.each([undefined, "*.txt,*"])(
    "does not follow external links with globs %s",
    async (globs) => {
      const result = await getGrepContent(
        { pattern: "needle", globs },
        { root: fixture.root },
      );
      expect(result).toContain("INTERNAL");
      expect(result).toContain("CHILD");
      for (const marker of [
        "EXTERNAL",
        "SIBLING",
        "RESTRICTED",
        "SPEKTA_IGNORED",
        "GIT_IGNORED",
        "MANAGED_IGNORED",
        "GLOBAL_IGNORED",
        "NESTED_IGNORED",
      ])
        expect(result).not.toContain(marker);
      expect(result).toContain("WHITELISTED");
    },
  );
  it("ignores hostile ripgrep configuration", async () => {
    const config = path.join(fixture.base, "rg-config");
    await fs.writeFile(config, `--follow\n${fixture.outside}\n`);
    process.env.RIPGREP_CONFIG_PATH = config;
    const result = await getGrepContent(
      { pattern: "needle", globs: "*" },
      { root: fixture.root },
    );
    expect(result).toContain("INTERNAL");
    expect(result).not.toContain("EXTERNAL");
  });
  it("uses explicit ignore root and preserves alias display names", async () => {
    process.chdir(fixture.ambient);
    const result = await getGrepContent(
      { pattern: "needle", globs: "*.txt" },
      { root: fixture.root },
    );
    expect(result).toContain("INTERNAL");
    expect(result).not.toContain("WRONG_CWD");
    expect(result).not.toContain("SPEKTA_IGNORED");
    const alias = await getGrepContent(
      { pattern: "needle", path: "internal-file.txt" },
      { root: fixture.alias },
    );
    expect(alias).toContain("#### internal-file.txt");
    expect(alias).not.toContain(fixture.root);
  });
  it.each(["..notes", "with space.txt", "-file.txt", "-"])(
    "accepts literal filename %s",
    async (target) => {
      expect(
        await getGrepContent(
          { pattern: "needle", path: target },
          { root: fixture.root },
        ),
      ).toContain("needle");
    },
  );
  it("treats patterns as literal regex operands and separates search paths", async () => {
    expect(
      await getGrepContent(
        { pattern: "-needle", path: "-" },
        { root: fixture.root },
      ),
    ).toContain("LITERAL_DASH");
    const target = path.join(fixture.root, "real.txt");
    const args = await buildGrepArgs(
      { pattern: "--follow", path: target, globs: "*" },
      fixture.root,
    );
    expect(args).toContain("--no-config");
    expect(args).toContain("--no-follow");
    expect(args[args.indexOf("--regexp") + 1]).toBe("--follow");
    expect(args.slice(-2)).toEqual(["--", target]);
    expect(args.indexOf("!**/.env")).toBeGreaterThan(args.indexOf("*"));
  });
  it("keeps default display and handles nongit workspaces", async () => {
    expect(
      await getGrepContent({ pattern: "needle" }, { root: fixture.root }),
    ).toContain(`#### .${path.sep}real.txt`);
    const root = path.join(fixture.base, "nongit");
    await fs.outputFile(path.join(root, "file.txt"), "needle NO_GIT\n");
    expect(await getGrepContent({ pattern: "needle" }, { root })).toContain(
      "NO_GIT",
    );
  });
});
