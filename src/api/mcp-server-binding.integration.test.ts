import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import { execa } from "execa";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../__tests__/workspace-fixture";
import type { ToolDefinition } from "../core/config";

const { registeredServers, executeRtkCommand } = vi.hoisted(() => ({
  registeredServers: [] as Array<
    Map<string, (args: Record<string, unknown>) => Promise<unknown>>
  >,
  executeRtkCommand: vi.fn(),
}));

const toolDefinitions: ToolDefinition[] = [
  {
    name: "spekta_read",
    description: "Read files",
    params: { paths: { description: "Files to read" } },
    xml_example: "<spekta_read></spekta_read>",
  },
  {
    name: "spekta_replace",
    description: "Replace text",
    params: {
      path: { description: "File path" },
      blocks: { description: "Replacement blocks" },
    },
    xml_example: "<spekta_replace></spekta_replace>",
  },
  {
    name: "spekta_write",
    description: "Write a new file",
    params: {
      path: { description: "File path" },
      content: { description: "File content" },
    },
    xml_example: "<spekta_write></spekta_write>",
  },
  {
    name: "spekta_grep",
    description: "Search files",
    params: { pattern: { description: "Search pattern" } },
    xml_example: "<spekta_grep></spekta_grep>",
  },
  {
    name: "spekta_shell",
    description: "Run a supported shell command",
    params: {
      command: { description: "Command" },
      args: { description: "Arguments" },
    },
    xml_example: "<spekta_shell></spekta_shell>",
  },
];

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: vi.fn(function () {
    const registered = new Map<
      string,
      (args: Record<string, unknown>) => Promise<unknown>
    >();
    registeredServers.push(registered);
    return {
      registerTool: (
        name: string,
        _options: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) => registered.set(name, handler),
      connect: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn(function () {
    return {};
  }),
}));

vi.mock("../core/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../core/config")>();
  return {
    ...actual,
    bootstrap: vi.fn().mockResolvedValue(undefined),
    loadToolDefinitions: vi.fn(),
  };
});

vi.mock("../commands/proxy/proxy-execution", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../commands/proxy/proxy-execution")>();
  return { ...actual, executeRtkCommand };
});

import {
  bootstrap as initializeProject,
  loadToolDefinitions,
} from "../core/config";
import { runMcpServer } from "./mcp-server/bootstrap";
import { createToolRegistry } from "./mcp-server/registry";

let fixture: WorkspaceFixture;

beforeEach(async () => {
  fixture = await createWorkspaceFixture();
  registeredServers.length = 0;
  executeRtkCommand.mockReset();
  vi.mocked(initializeProject).mockClear();
  vi.mocked(loadToolDefinitions).mockClear();
  executeRtkCommand.mockImplementation(
    (command: string, _args: string[], context: { root: string }) => ({
      available: true,
      stdout:
        command === "ls"
          ? `${fs.readdirSync(context.root).sort().join("\n")}\n`
          : command === "git"
            ? ""
            : context.root,
      stderr: "",
      exitCode: 0,
    }),
  );
  vi.mocked(loadToolDefinitions).mockResolvedValue(toolDefinitions);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fixture.cleanup();
});

describe("MCP server workspace binding", () => {
  it("binds a relative registry root before cwd changes", async () => {
    process.chdir(fixture.root);
    const context = { root: "." };
    const tools = createToolRegistry(context);
    context.root = fixture.ambient;
    process.chdir(fixture.ambient);

    expect(
      await tools.spekta_write.handler({
        path: "created.txt",
        content: "launch content",
      }),
    ).not.toHaveProperty("isError", true);
    expect(
      await tools.spekta_replace.handler({
        path: "created.txt",
        blocks:
          "<<<<<<< SEARCH\nlaunch content\n=======\nupdated launch\n>>>>>>> REPLACE",
      }),
    ).not.toHaveProperty("isError", true);
    const read = await tools.spekta_read.handler({ paths: ["created.txt"] });
    const search = await tools.spekta_grep.handler({
      pattern: "updated launch",
    });
    expect(JSON.stringify(read)).toContain("updated launch");
    expect(JSON.stringify(search)).toContain("updated launch");
    expect(
      await tools.spekta_shell.handler({ command: "ls", args: ["."] }),
    ).toMatchObject({ isError: false });
    expect(executeRtkCommand).toHaveBeenCalledWith("ls", ["."], {
      root: fixture.root,
    });
    expect(await fs.pathExists(path.join(fixture.ambient, "created.txt"))).toBe(
      false,
    );
    expect(
      await tools.spekta_shell.handler({
        command: "ls",
        args: ["../sibling.txt"],
      }),
    ).toMatchObject({ isError: true });
    expect(executeRtkCommand).toHaveBeenCalledOnce();
  });

  it("binds a nested launch workspace and denies identically named parent and outside files", async () => {
    const nestedRoot = path.join(fixture.root, "nested");
    await fs.ensureDir(nestedRoot);
    await fs.writeFile(
      path.join(fixture.root, "identity.txt"),
      "PARENT_WORKSPACE_SENTINEL\n",
    );
    await fs.writeFile(
      path.join(nestedRoot, "identity.txt"),
      "NESTED_WORKSPACE_SENTINEL\n",
    );
    const outsideTarget = path.join(fixture.outside, "secret.txt");

    process.chdir(nestedRoot);
    await runMcpServer();
    const tools = registeredServers[0];
    const nestedRead = await tools.get("spekta_read")!({
      paths: ["identity.txt"],
    });
    const parentRead = await tools.get("spekta_read")!({
      paths: ["../identity.txt"],
    });
    const outsideRead = await tools.get("spekta_read")!({
      paths: [outsideTarget],
    });

    expect(JSON.stringify(nestedRead)).toContain("NESTED_WORKSPACE_SENTINEL");
    expect(JSON.stringify(nestedRead)).not.toContain(
      "PARENT_WORKSPACE_SENTINEL",
    );
    expect(parentRead).toHaveProperty("isError", true);
    expect(JSON.stringify(parentRead)).not.toContain(
      "PARENT_WORKSPACE_SENTINEL",
    );
    expect(outsideRead).toHaveProperty("isError", true);
    expect(JSON.stringify(outsideRead)).not.toContain("EXTERNAL");
  });

  it("keeps two launched servers bound through concurrent read, write, replace, search, and shell calls", async () => {
    const secondRoot = path.join(fixture.base, "second-repo");
    await fs.ensureDir(secondRoot);
    await execa("git", ["init", "--quiet"], { cwd: secondRoot });
    await fs.writeFile(path.join(secondRoot, "real.txt"), "needle SECOND\n");
    await fs.writeFile(path.join(secondRoot, ".spektaignore"), "\n");

    process.chdir(fixture.root);
    await runMcpServer();
    process.chdir(secondRoot);
    await runMcpServer();
    process.chdir(fixture.ambient);
    const chdirSpy = vi.spyOn(process, "chdir");

    expect(registeredServers).toHaveLength(2);
    const first = registeredServers[0];
    const second = registeredServers[1];
    const firstBlocks =
      "<<<<<<< SEARCH\nneedle INTERNAL\n=======\nupdated FIRST\n>>>>>>> REPLACE";
    const secondBlocks =
      "<<<<<<< SEARCH\nneedle SECOND\n=======\nupdated SECOND\n>>>>>>> REPLACE";

    const writes = await Promise.all([
      first.get("spekta_write")!({
        path: "created.txt",
        content: "FIRST",
        cwd: secondRoot,
        workspace: { root: secondRoot },
        root: secondRoot,
      }),
      second.get("spekta_write")!({ path: "created.txt", content: "SECOND" }),
    ]);
    expect(writes).toEqual([
      expect.not.objectContaining({ isError: true }),
      expect.not.objectContaining({ isError: true }),
    ]);
    expect(
      await fs.readFile(path.join(fixture.root, "created.txt"), "utf8"),
    ).toBe("FIRST");
    expect(
      await fs.readFile(path.join(secondRoot, "created.txt"), "utf8"),
    ).toBe("SECOND");

    await Promise.all([
      first.get("spekta_replace")!({ path: "real.txt", blocks: firstBlocks }),
      second.get("spekta_replace")!({ path: "real.txt", blocks: secondBlocks }),
    ]);
    const [
      firstRead,
      secondRead,
      firstSearch,
      secondSearch,
      firstShell,
      secondShell,
      firstGit,
      secondGit,
    ] = await Promise.all([
      first.get("spekta_read")!({ paths: ["created.txt", "real.txt"] }),
      second.get("spekta_read")!({ paths: ["created.txt", "real.txt"] }),
      first.get("spekta_grep")!({ pattern: "updated" }),
      second.get("spekta_grep")!({ pattern: "updated" }),
      first.get("spekta_shell")!({ command: "ls", args: ["."] }),
      second.get("spekta_shell")!({ command: "ls", args: ["."] }),
      first.get("spekta_shell")!({
        command: "git",
        args: ["status", "--short"],
      }),
      second.get("spekta_shell")!({
        command: "git",
        args: ["status", "--short"],
      }),
    ]);

    expect(JSON.stringify(firstRead)).toContain("FIRST");
    expect(JSON.stringify(firstRead)).toContain("updated FIRST");
    expect(JSON.stringify(firstRead)).not.toContain("SECOND");
    expect(JSON.stringify(secondRead)).toContain("SECOND");
    expect(JSON.stringify(secondRead)).toContain("updated SECOND");
    expect(JSON.stringify(secondRead)).not.toContain("FIRST");
    expect(JSON.stringify(firstSearch)).toContain("updated FIRST");
    expect(JSON.stringify(firstSearch)).not.toContain("updated SECOND");
    expect(JSON.stringify(secondSearch)).toContain("updated SECOND");
    expect(JSON.stringify(secondSearch)).not.toContain("updated FIRST");
    expect(firstShell).toMatchObject({ isError: false });
    expect(secondShell).toMatchObject({ isError: false });
    expect(firstGit).not.toHaveProperty("isError", true);
    expect(secondGit).not.toHaveProperty("isError", true);
    expect(executeRtkCommand).toHaveBeenNthCalledWith(1, "ls", ["."], {
      root: fixture.root,
    });
    expect(executeRtkCommand).toHaveBeenNthCalledWith(2, "ls", ["."], {
      root: secondRoot,
    });
    expect(executeRtkCommand).toHaveBeenNthCalledWith(
      3,
      "git",
      ["status", "--short"],
      { root: fixture.root },
    );
    expect(executeRtkCommand).toHaveBeenNthCalledWith(
      4,
      "git",
      ["status", "--short"],
      { root: secondRoot },
    );
    expect(chdirSpy).not.toHaveBeenCalled();
  });

  it("canonicalizes a symlink launch workspace and keeps the binding immutable", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(fixture.alias);
    await runMcpServer();
    await registeredServers[0].get("spekta_shell")!({ command: "ls" });
    const context = executeRtkCommand.mock.calls[0][2] as { root: string };
    expect(context.root).toBe(fixture.root);
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("rejects escaping paths through registered handlers before shell execution", async () => {
    process.chdir(fixture.root);
    await runMcpServer();
    process.chdir(fixture.ambient);
    const tools = registeredServers[0];
    for (const target of [
      "../sibling.txt",
      path.join(fixture.repo, "sibling.txt"),
      "external-file.txt",
      "external-dir/secret.txt",
    ]) {
      for (const [name, args] of [
        ["spekta_read", { paths: [target] }],
        ["spekta_grep", { pattern: "needle", path: target }],
        ["spekta_write", { path: target, content: "escape" }],
        ["spekta_replace", { path: target, blocks: "invalid blocks" }],
        ["spekta_shell", { command: "ls", args: [target] }],
      ] as const) {
        await expect(tools.get(name)!(args)).resolves.toMatchObject({
          isError: true,
        });
      }
    }
    await expect(
      tools.get("spekta_shell")!({
        command: "git",
        args: ["-C", fixture.repo, "status"],
      }),
    ).resolves.toMatchObject({ isError: true });
    expect(executeRtkCommand).not.toHaveBeenCalled();
    expect(
      await fs.readFile(path.join(fixture.repo, "sibling.txt"), "utf8"),
    ).toContain("SIBLING");
    expect(
      await fs.readFile(path.join(fixture.outside, "secret.txt"), "utf8"),
    ).toContain("EXTERNAL");
  });

  it.each(["missing-launch-directory", "real.txt", "dangling.txt", "cycle-a"])(
    "rejects invalid launch %s before initializing or registering tools",
    async (target) => {
      const invalidCwd = path.join(fixture.root, target);
      vi.spyOn(process, "cwd").mockReturnValue(invalidCwd);
      await expect(runMcpServer()).rejects.toThrow();
      expect(registeredServers).toHaveLength(0);
      expect(initializeProject).not.toHaveBeenCalled();
      expect(loadToolDefinitions).not.toHaveBeenCalled();
    },
  );
});
