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
  it("real MCP handlers keep eligible output and reject escapes", async () => {
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
      const read = await TOOL_REGISTRY.spekta_read.handler({ paths: [target] });
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
  });

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
      expect(result.content[0].text).toContain("#### large-read.txt");
      expect(result.content[0].text).toContain("[INCOMPLETE:");
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
    vi.spyOn(readUtils, "getFileLines").mockRejectedValueOnce(
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
        firstServer.spekta_rg.handler({ patterns: ["needle"] }),
        secondServer.spekta_rg.handler({ patterns: ["needle"] }),
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
