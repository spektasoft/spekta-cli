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
  it.each(["read", "grep"])(
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
      expect(errors).toHaveBeenCalledWith(expect.stringContaining("outside"));
      expect(process.exitCode).toBe(1);
      expect(output.join("")).not.toContain("SIBLING");
    },
  );
  it("CLI commands deny symlink escapes", async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    vi.spyOn(Logger, "error").mockImplementation(() => true);
    for (const command of ["read", "grep"]) {
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
  it("real MCP handlers keep eligible output and reject escapes", async () => {
    expect(
      (await TOOL_REGISTRY.spekta_read.handler({ paths: ["real.txt"] }))
        .content[0].text,
    ).toContain("INTERNAL");
    expect(
      (await TOOL_REGISTRY.spekta_grep.handler({ pattern: "needle" }))
        .content[0].text,
    ).toContain("INTERNAL");
    for (const target of [
      "../sibling.txt",
      "external-file.txt",
      "external-dir/secret.txt",
    ]) {
      await expect(
        TOOL_REGISTRY.spekta_read.handler({ paths: [target] }),
      ).rejects.toThrow("outside");
      await expect(
        TOOL_REGISTRY.spekta_grep.handler({ pattern: "needle", path: target }),
      ).rejects.toThrow("outside");
    }
  });

  it("keeps overlapping server registries on their own roots and ignore files", async () => {
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
        firstServer.spekta_grep.handler({ pattern: "needle" }),
        secondServer.spekta_grep.handler({ pattern: "needle" }),
      ]);

    expect(firstRead.content[0].text).toContain("INTERNAL");
    expect(firstRead.content[0].text).not.toContain("WRONG_CWD");
    expect(secondRead.content[0].text).toContain("SECOND");
    expect(firstSearch.content[0].text).toContain("INTERNAL");
    expect(firstSearch.content[0].text).not.toContain("WRONG_CWD");
    expect(secondSearch.content[0].text).toContain("SECOND_IGNORED");
  });

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
