import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../__tests__/workspace-fixture";
import { dispatchCommand } from "../cli/commands";
import { createToolRegistry, TOOL_REGISTRY } from "./mcp-server/registry";
import { Logger } from "../utils/logger";
import fs from "fs-extra";
import path from "node:path";
import { execa } from "execa";
import { getMinimumMcpReadResponseBudget } from "../commands/read";
import { getTokenCount } from "../utils/read-utils";
import * as readUtils from "../utils/read-utils";
import { serializeMcpToolReply } from "../__tests__/mcp-response-test-utils";

vi.setConfig({
  testTimeout: process.platform === "win32" ? 30_000 : 5_000,
});

let fixture: WorkspaceFixture;
let originalExitCode: typeof process.exitCode;
beforeEach(async () => {
  originalExitCode = process.exitCode;
  fixture = await createWorkspaceFixture();
  process.chdir(fixture.root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.cleanup();
  process.exitCode = originalExitCode;
});

describe("CLI and existing MCP workspace boundaries", () => {
  it("searches nested Git-ignored resources through CLI and MCP without a whitelist", async () => {
    const nested = path.join(fixture.root, "nested-git-ignored");
    const target = path.join(nested, "search-target.log");
    const marker = "NESTED_GIT_IGNORED_SEARCH";
    await fs.ensureDir(nested);
    await fs.writeFile(path.join(nested, ".gitignore"), "*.log\n");
    await fs.writeFile(target, `${marker}\n`);
    expect(
      (
        await execa(
          "git",
          ["check-ignore", "-q", "--", "nested-git-ignored/search-target.log"],
          {
            cwd: fixture.root,
            reject: false,
          },
        )
      ).exitCode,
    ).toBe(0);

    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    vi.spyOn(Logger, "error").mockImplementation(() => true);
    await dispatchCommand("rg", [marker]);
    expect(output.join("")).toContain(marker);

    const discovered = await TOOL_REGISTRY.spekta_rg.handler({
      patterns: [marker],
    });
    expect(discovered.isError).toBeUndefined();
    expect(discovered.content[0].text).toContain(marker);

    const explicit = await TOOL_REGISTRY.spekta_rg.handler({
      patterns: [marker],
      paths: ["nested-git-ignored/search-target.log"],
    });
    expect(explicit.isError).toBeUndefined();
    expect(explicit.content[0].text).toContain(marker);
  });

  it("reads a Git-ignored file through CLI and MCP without disclosing denied siblings", async () => {
    const target = "git-ignored.txt";
    expect(
      (
        await execa("git", ["check-ignore", "-q", "--", target], {
          cwd: fixture.root,
          reject: false,
        })
      ).exitCode,
    ).toBe(0);

    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    vi.spyOn(Logger, "error").mockImplementation(() => true);
    await dispatchCommand("read", [target]);
    expect(output.join("")).toContain("GIT_IGNORED");

    const allowed = await TOOL_REGISTRY.spekta_read.handler({
      paths: [target],
    });
    expect(allowed.isError).toBeUndefined();
    expect(allowed.content[0].text).toContain("GIT_IGNORED");

    const denied = await TOOL_REGISTRY.spekta_read.handler({
      paths: ["ignored.txt"],
    });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).not.toContain("ignored.txt");
    expect(JSON.stringify(denied)).not.toContain("SPEKTA_IGNORED");
  });

  it("checks the canonical target of a symlink alias to a Git-ignored file", async () => {
    if (process.platform === "win32") return;
    await fs.symlink(
      path.join(fixture.root, "git-ignored.txt"),
      path.join(fixture.root, "ignored-target-alias.txt"),
    );
    const result = await TOOL_REGISTRY.spekta_read.handler({
      paths: ["ignored-target-alias.txt"],
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("GIT_IGNORED");
  });

  it.each(["read", "rg"])(
    "CLI %s limits access to invocation cwd",
    async (command) => {
      const output: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        output.push(String(chunk));
        return true;
      });
      const errors = vi.spyOn(Logger, "error").mockImplementation(() => true);
      await dispatchCommand(
        command,
        command === "read" ? ["real.txt"] : ["needle", "real.txt"],
      );
      expect(output.join("")).toContain("INTERNAL");
      output.length = 0;
      process.exitCode = undefined;
      await dispatchCommand(
        command,
        command === "read" ? ["../sibling.txt"] : ["needle", "../sibling.txt"],
      );
      expect(errors).not.toHaveBeenCalledWith(
        expect.stringContaining("sibling.txt"),
      );
      expect(process.exitCode).toBe(1);
      expect(output.join("")).not.toContain("SIBLING");
      expect(output.join("")).not.toContain("sibling.txt");
    },
  );
  it(
    "reads and searches relative paths with either separator and spaces",
    async () => {
      await fs.ensureDir(path.join(fixture.root, "nested dir"));
      await fs.writeFile(
        path.join(fixture.root, "nested dir", "entry file.txt"),
        "needle WINDOWS_PATH_INPUT\n",
      );

      for (const target of [
        "nested dir/entry file.txt",
        String.raw`nested dir\entry file.txt`,
        path.join(fixture.root, "nested dir", "entry file.txt"),
      ]) {
        const read = await TOOL_REGISTRY.spekta_read.handler({
          paths: [target],
        });
        expect(read.content[0].text).toContain("WINDOWS_PATH_INPUT");
        const search = await TOOL_REGISTRY.spekta_rg.handler({
          patterns: ["WINDOWS_PATH_INPUT"],
          paths: [target],
        });
        expect(search.content[0].text).toContain("WINDOWS_PATH_INPUT");
      }
    },
    process.platform === "win32" ? 30_000 : undefined,
  );
  it("CLI commands deny symlink escapes", async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    vi.spyOn(Logger, "error").mockImplementation(() => true);
    for (const command of ["read", "rg"]) {
      process.exitCode = undefined;
      await dispatchCommand(
        command,
        command === "read"
          ? ["external-file.txt"]
          : ["needle", "external-file.txt"],
      );
      expect(process.exitCode).toBe(1);
    }
    expect(output.join("")).not.toContain("EXTERNAL");
  });
  it("CLI and MCP reads enforce exact sensitive-file exceptions", async () => {
    const target = "keys/private.key";
    const sibling = "keys/other.key";
    await fs.outputFile(path.join(fixture.root, target), "SYNTHETIC_PRIVATE\n");
    await fs.outputFile(
      path.join(fixture.root, sibling),
      "SYNTHETIC_SIBLING\n",
    );

    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const errors = vi.spyOn(Logger, "error").mockImplementation(() => true);

    await dispatchCommand("read", [target]);
    expect(process.exitCode).toBe(1);
    expect(output.join("")).not.toContain(target);
    expect(output.join("")).not.toContain("SYNTHETIC_PRIVATE");
    expect(errors).not.toHaveBeenCalledWith(expect.stringContaining(target));

    const denied = await TOOL_REGISTRY.spekta_read.handler({ paths: [target] });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).not.toContain(target);
    expect(JSON.stringify(denied)).not.toContain("SYNTHETIC_PRIVATE");

    await fs.appendFile(
      path.join(fixture.root, ".spektaignore"),
      `!${target}\n`,
    );
    process.exitCode = undefined;
    output.length = 0;
    await dispatchCommand("read", [target]);
    expect(output.join("")).toContain("SYNTHETIC_PRIVATE");

    const allowed = await TOOL_REGISTRY.spekta_read.handler({
      paths: [target],
    });
    expect(allowed.content[0].text).toContain("SYNTHETIC_PRIVATE");
    const deniedSibling = await TOOL_REGISTRY.spekta_read.handler({
      paths: [sibling],
    });
    expect(deniedSibling.isError).toBe(true);
    expect(JSON.stringify(deniedSibling)).not.toContain(sibling);
    expect(JSON.stringify(deniedSibling)).not.toContain("SYNTHETIC_SIBLING");
  });

  it(
    "real MCP handlers keep eligible output and reject escapes",
    async () => {
      expect(
        (await TOOL_REGISTRY.spekta_read.handler({ paths: ["real.txt"] }))
          .content[0].text,
      ).toContain("INTERNAL");
      expect(
        (await TOOL_REGISTRY.spekta_rg.handler({ patterns: ["needle"] }))
          .content[0].text,
      ).toContain("INTERNAL");
      for (const target of [
        "../sibling.txt",
        "external-file.txt",
        "external-dir/secret.txt",
      ]) {
        const read = await TOOL_REGISTRY.spekta_read.handler({
          paths: [target],
        });
        const search = await TOOL_REGISTRY.spekta_rg.handler({
          patterns: ["needle"],
          paths: [target],
        });
        for (const response of [read, search]) {
          const fields = JSON.stringify(response);
          expect(response.isError).toBe(true);
          expect(fields).not.toContain(target);
          expect(fields).not.toContain("SIBLING");
          expect(fields).not.toContain("EXTERNAL");
        }
      }
    },
    process.platform === "win32" ? 30_000 : undefined,
  );

  it("bounds a formatted read delivered through the MCP handler", async () => {
    const previousLimit = process.env.SPEKTA_READ_TOKEN_LIMIT;
    process.env.SPEKTA_READ_TOKEN_LIMIT = "100";
    const requestId = `read-budget-${"x".repeat(120)}`;
    try {
      await fs.writeFile(
        path.join(fixture.root, "large-read.txt"),
        `${"long formatted content line\n".repeat(100)}`,
      );
      const result = await TOOL_REGISTRY.spekta_read.handler(
        { paths: ["large-read.txt"] },
        undefined,
        requestId,
      );
      const completeReply = serializeMcpToolReply(requestId, result);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("output_limit_exceeded");
      expect(result.content[0].text).not.toContain("long formatted content");
      expect(getTokenCount(completeReply)).toBeLessThanOrEqual(
        Math.max(100, getMinimumMcpReadResponseBudget(requestId)),
      );
    } finally {
      if (previousLimit === undefined)
        delete process.env.SPEKTA_READ_TOKEN_LIMIT;
      else process.env.SPEKTA_READ_TOKEN_LIMIT = previousLimit;
    }
  });

  it("marks an authorized read execution failure as an MCP error", async () => {
    const tools = createToolRegistry({ root: fixture.root });
    vi.spyOn(readUtils, "getVersionedFileLines").mockRejectedValueOnce(
      new Error("I/O failure PRIVATE_DIAGNOSTIC"),
    );

    const response = await tools.spekta_read.handler(
      { paths: ["real.txt"] },
      undefined,
      "read-failure",
    );

    expect(response.isError).toBe(true);
    const fields = JSON.stringify(response);
    expect(fields).toContain("Read failed");
    expect(fields).not.toContain("PRIVATE_DIAGNOSTIC");
    expect(fields).not.toContain("real.txt");
  });

  it(
    "keeps overlapping server registries on their own roots and ignore files",
    async () => {
      const secondRoot = path.join(fixture.base, "second-workspace");
      await fs.ensureDir(secondRoot);
      await execa("git", ["init", "--quiet"], { cwd: secondRoot });
      await fs.writeFile(path.join(secondRoot, "real.txt"), "needle SECOND\n");
      await fs.writeFile(
        path.join(secondRoot, "ignored.txt"),
        "needle SECOND_IGNORED\n",
      );
      await fs.writeFile(path.join(secondRoot, ".spektaignore"), "\n");

      const firstServer = createToolRegistry({ root: fixture.root });
      const secondServer = createToolRegistry({ root: secondRoot });
      process.chdir(fixture.ambient);

      const [firstRead, secondRead, firstSearch, secondSearch] =
        await Promise.all([
          firstServer.spekta_read.handler({ paths: ["real.txt"] }),
          secondServer.spekta_read.handler({ paths: ["real.txt"] }),
          firstServer.spekta_rg.handler({ patterns: ["needle"] }),
          secondServer.spekta_rg.handler({ patterns: ["needle"] }),
        ]);

      expect(firstRead.content[0].text).toContain("INTERNAL");
      expect(firstRead.content[0].text).not.toContain("WRONG_CWD");
      expect(secondRead.content[0].text).toContain("SECOND");
      expect(firstSearch.content[0].text).toContain("INTERNAL");
      expect(firstSearch.content[0].text).not.toContain("WRONG_CWD");
      expect(secondSearch.content[0].text).toContain("SECOND_IGNORED");
    },
    process.platform === "win32" ? 30_000 : undefined,
  );

  it("bound MCP mutations reject traversal and symlink escapes", async () => {
    const tools = createToolRegistry({ root: fixture.root });
    for (const target of ["../sibling.txt", "external-file.txt"]) {
      await expect(
        tools.spekta_write.handler({ path: target, content: "escape" }),
      ).resolves.toMatchObject({ isError: true });
      await expect(
        tools.spekta_replace.handler({ path: target, blocks: "replacement" }),
      ).resolves.toMatchObject({ isError: true });
    }
    expect(
      await fs.readFile(path.join(fixture.repo, "sibling.txt"), "utf8"),
    ).toContain("SIBLING");
    expect(
      await fs.readFile(path.join(fixture.outside, "secret.txt"), "utf8"),
    ).toContain("EXTERNAL");
  });
});
