import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import { spawn } from "node:child_process";
import { execa } from "execa";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
let tempRoot: string;
let entry: string;

type RpcMessage = {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  result?: Record<string, unknown>;
  error?: unknown;
};

function getToolNames(message: RpcMessage): string[] {
  const tools = message.result?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool: unknown) => {
    if (typeof tool !== "object" || tool === null || !("name" in tool)) {
      return [];
    }
    return typeof tool.name === "string" ? [tool.name] : [];
  });
}

async function snapshotTree(
  root: string,
): Promise<Record<string, { bytes: string; mtimeMs: number }>> {
  const snapshot: Record<string, { bytes: string; mtimeMs: number }> = {};
  if (!(await fs.pathExists(root))) return snapshot;
  for (const item of await fs.readdir(root, { withFileTypes: true })) {
    const fullPath = path.join(root, item.name);
    const relative = path.relative(root, fullPath);
    if (item.isDirectory()) {
      Object.assign(
        snapshot,
        Object.fromEntries(
          Object.entries(await snapshotTree(fullPath)).map(([name, value]) => [
            path.join(relative, name),
            value,
          ]),
        ),
      );
    } else {
      const stat = await fs.stat(fullPath);
      snapshot[relative] = {
        bytes: (await fs.readFile(fullPath)).toString("base64"),
        mtimeMs: stat.mtimeMs,
      };
    }
  }
  return snapshot;
}

async function start(home: string, extraEnv: Record<string, string> = {}) {
  const child = spawn(process.execPath, [entry, "mcp"], {
    cwd: projectRoot,
    env: { ...process.env, SPEKTA_HOME_OVERRIDE: home, ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", reject);
  });
  let remainder = "";
  let stderr = "";
  const messages: RpcMessage[] = [];
  const waiters = new Map<string | number, (message: RpcMessage) => void>();
  child.stdout.on("data", (chunk: Buffer) => {
    remainder += chunk.toString();
    while (remainder.includes("\n")) {
      const newline = remainder.indexOf("\n");
      const line = remainder.slice(0, newline);
      remainder = remainder.slice(newline + 1);
      if (!line.trim()) continue;
      let message: RpcMessage;
      try {
        message = JSON.parse(line) as RpcMessage;
      } catch {
        throw new Error(`Non-JSON stdout from spekta mcp: ${line}`);
      }
      if (message.jsonrpc !== "2.0") throw new Error(`Non-MCP stdout: ${line}`);
      messages.push(message);
      if (message.id !== undefined) waiters.get(message.id)?.(message);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  let nextId = 0;
  const request = (method: string, params?: unknown) => {
    const id = ++nextId;
    return new Promise<RpcMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(id);
        reject(
          new Error(
            `Timed out waiting for ${method}; pid=${child.pid}; exit=${child.exitCode}; signal=${child.signalCode}; stderr=${stderr}; messages=${JSON.stringify(messages)}`,
          ),
        );
      }, 5000);
      waiters.set(id, (message) => {
        clearTimeout(timer);
        waiters.delete(id);
        resolve(message);
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })}\n`,
      );
    });
  };
  const notify = (method: string, params?: unknown) =>
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) })}\n`,
    );
  const close = async () => {
    child.stdin.end();
    const code = await Promise.race([
      new Promise<number | null>((resolve) =>
        child.once("close", (value) => resolve(value)),
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("MCP child did not exit")), 5000),
      ),
    ]);
    return { code, stderr, messages };
  };
  return {
    request,
    notify,
    close,
    child,
    get stderr() {
      return stderr;
    },
    messages,
  };
}

async function initialize(client: Awaited<ReturnType<typeof start>>) {
  const response = await client.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "independent-process-test", version: "1.0" },
  });
  expect(response.error).toBeUndefined();
  client.notify("notifications/initialized");
}

beforeAll(async () => {
  tempRoot = await fs.mkdtemp(path.join(projectRoot, ".mcp-process-"));
  const buildDir = path.join(tempRoot, "build");
  await execa("npm", ["run", "build", "--", "--outDir", buildDir], {
    cwd: projectRoot,
  });
  entry = path.join(buildDir, "index.js");
});

afterAll(async () => {
  if (tempRoot) await fs.remove(tempRoot);
});

describe("spekta mcp process", () => {
  it("initializes, lists and calls tools without writing an empty home", async () => {
    const home = path.join(tempRoot, "empty-home");
    await fs.ensureDir(home);
    const before = await snapshotTree(home);
    const client = await start(home);
    try {
      await initialize(client);
      const listing = await client.request("tools/list");
      expect(listing.error).toBeUndefined();
      expect(getToolNames(listing)).toContain("spekta_rg");
      expect(getToolNames(listing)).not.toContain("spekta_grep");
      const call = await client.request("tools/call", {
        name: "spekta_rg",
        arguments: { patterns: ["Ticket 13"], paths: ["README.md"] },
      });
      expect(call.error).toBeUndefined();
      expect(call.result?.isError).not.toBe(true);
      const result = await client.close();
      expect(result.code).toBe(0);
      expect(
        result.messages.every((message) => message.jsonrpc === "2.0"),
      ).toBe(true);
      expect(await snapshotTree(home)).toEqual(before);
    } finally {
      if (client.child.exitCode === null) client.child.kill("SIGKILL");
    }
  }, 30000);

  it("preserves pre-existing home files byte-for-byte and by modification time", async () => {
    const home = path.join(tempRoot, "populated-home");
    await fs.ensureDir(path.join(home, "tools"));
    await fs.writeFile(path.join(home, "providers.yaml"), "providers: {}\n");
    await fs.writeFile(path.join(home, "models.yaml"), "models: []\n");
    await fs.writeFile(path.join(home, "user.yaml"), "theme: quiet\n");
    await fs.writeFile(
      path.join(home, "tools", "grep.yaml"),
      "name: spekta_grep\ndescription: legacy custom search\nparams: {}\nxml_example: <grep />\n",
    );
    const before = await snapshotTree(home);
    const client = await start(home);
    try {
      await initialize(client);
      await client.request("tools/list");
      await client.request("tools/call", {
        name: "spekta_rg",
        arguments: { patterns: ["Ticket 13"], paths: ["README.md"] },
      });
      expect((await client.close()).code).toBe(0);
      expect(await snapshotTree(home)).toEqual(before);
    } finally {
      if (client.child.exitCode === null) client.child.kill("SIGKILL");
    }
  }, 30000);

  it("keeps usable tools when overrides are malformed, unknown, duplicated, or undocumented", async () => {
    const home = path.join(tempRoot, "override-home");
    const toolsDir = path.join(home, "tools");
    await fs.ensureDir(toolsDir);
    await fs.writeFile(path.join(toolsDir, "read.yaml"), "not: [valid");
    await fs.writeFile(
      path.join(toolsDir, "replace.yaml"),
      [
        "name: custom_unknown",
        "description: Unknown implementation",
        "params: {}",
        "xml_example: <custom_unknown />",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(toolsDir, "write.yaml"),
      [
        "name: spekta_rg",
        "description: Duplicate name",
        "params: {}",
        "xml_example: <spekta_rg />",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(toolsDir, "rg.yaml"),
      [
        "name: spekta_rg",
        "description: Search files",
        "params:",
        "  patterns:",
        "    description: ''",
        "xml_example: <spekta_rg />",
        "",
      ].join("\n"),
    );
    const client = await start(home);
    try {
      await initialize(client);
      const listing = await client.request("tools/list");
      expect(getToolNames(listing)).toContain("spekta_rg");
      expect(getToolNames(listing)).not.toContain("spekta_grep");
      const call = await client.request("tools/call", {
        name: "spekta_rg",
        arguments: { patterns: ["Ticket 13"], paths: ["README.md"] },
      });
      expect(call.error).toBeUndefined();
      expect(call.result?.isError).not.toBe(true);
      expect((await client.close()).code).toBe(0);
      expect(client.stderr).toMatch(/Failed to load tool read/);
      expect(client.stderr).toMatch(/custom_unknown.*no implementation/i);
      expect(client.stderr).toMatch(/Duplicate tool name/);
      expect(client.stderr).toMatch(/lacks a description/);
      expect(client.stderr).not.toContain(`${String.fromCharCode(27)}[`);
    } finally {
      if (client.child.exitCode === null) client.child.kill("SIGKILL");
    }
  }, 30000);

  it("returns protocol errors for invalid tool calls and stays connected for later requests", async () => {
    const home = path.join(tempRoot, "error-home");
    const client = await start(home);
    try {
      await initialize(client);
      const invalid = await client.request("tools/call", {
        name: "spekta_rg",
        arguments: { patterns: 3 },
      });
      expect(
        invalid.error !== undefined || invalid.result?.isError === true,
      ).toBe(true);
      const missing = await client.request("tools/call", {
        name: "missing_tool",
        arguments: {},
      });
      expect(
        missing.error !== undefined || missing.result?.isError === true,
      ).toBe(true);
      const failed = await client.request("tools/call", {
        name: "spekta_read",
        arguments: { paths: [] },
      });
      expect(failed.result?.isError).toBe(true);
      const succeeding = await client.request("tools/call", {
        name: "spekta_rg",
        arguments: { patterns: ["Ticket 13"], paths: ["README.md"] },
      });
      expect(succeeding.error).toBeUndefined();
      expect(succeeding.result?.isError).not.toBe(true);
      const result = await client.close();
      expect(result.code).toBe(0);
      // Tool failures are returned through MCP; do not duplicate them on stderr.
      expect(result.stderr).toBe("");
      expect(
        result.messages.every((message) => message.jsonrpc === "2.0"),
      ).toBe(true);
    } finally {
      if (client.child.exitCode === null) client.child.kill("SIGKILL");
    }
  }, 30000);

  it("reports missing templates on stderr and exits without touching home", async () => {
    const home = path.join(tempRoot, "missing-assets-home");
    await fs.ensureDir(home);
    const before = await snapshotTree(home);
    const child = spawn(process.execPath, [entry, "mcp"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        SPEKTA_HOME_OVERRIDE: home,
        SPEKTA_ASSET_ROOT_OVERRIDE: path.join(tempRoot, "missing-assets"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const code = await Promise.race([
      new Promise<number | null>((resolve) => child.once("close", resolve)),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("MCP startup did not fail")), 5000),
      ),
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/tool templates not found/i);
    expect(stdout).toBe("");
    expect(await snapshotTree(home)).toEqual(before);
  }, 30000);
});
