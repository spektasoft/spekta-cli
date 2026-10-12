import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fs from "fs-extra";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceFixture,
  type WorkspaceFixture,
} from "../../__tests__/workspace-fixture";
import { createToolRegistry } from "../../api/mcp-server/registry";
import { getTokenCount } from "../../utils/read-utils";
import { runRg } from "../rg";

let fixture: WorkspaceFixture;
let originalPath: string | undefined;
let originalCwd: string;
let binPath: string;

beforeEach(async () => {
  fixture = await createWorkspaceFixture();
  originalCwd = process.cwd();
  originalPath = process.env.PATH;
  binPath = await fs.mkdtemp(path.join(os.tmpdir(), "rtk-interrupt-"));
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  const pidPath = path.join(fixture.root, "descendant.pid");
  if (await fs.pathExists(pidPath)) {
    try {
      process.kill(Number(await fs.readFile(pidPath, "utf8")), "SIGKILL");
    } catch {
      // The lifecycle may already have reaped the process.
    }
  }
  await fs.remove(binPath);
  await fixture.cleanup();
});

async function installRtk(
  mode: "preparation" | "search" | "normal",
  root: string,
) {
  const startedPath = path.join(root, "rtk.started");
  const stoppedPath = path.join(root, "descendant.stopped");
  const pidPath = path.join(root, "descendant.pid");
  const descendant = `const fs = require("node:fs"); process.on("SIGTERM", () => { fs.writeFileSync(${JSON.stringify(stoppedPath)}, "stopped"); process.exit(0); }); fs.writeFileSync(${JSON.stringify(startedPath)}, "started"); setInterval(() => {}, 1000);`;
  const script = `#!${process.execPath}
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const args = process.argv.slice(2);
const preparing = args[0] === "proxy" && args[1] === "rg" && args.includes("--version");
if (args.length === 1 && args[0] === "--version") { console.log("rtk 1"); process.exit(0); }
if (preparing && ${JSON.stringify(mode)} !== "preparation") { console.log("ripgrep 1"); process.exit(0); }
if (args.includes("--files") && ${JSON.stringify(mode)} === "search") process.exit(0);
if (args.includes("--files") && ${JSON.stringify(mode)} === "normal") { process.stdout.write("fixture.txt\\0"); process.exit(0); }
if (args[0] === "proxy" && args[1] === "rg" && args.includes("--json") && ${JSON.stringify(mode)} === "normal") {
  console.log(JSON.stringify({ type: "match", data: { path: { text: "fixture.txt" }, line_number: 1, submatches: [{ start: 0 }], lines: { text: "needle found\\n" } } }));
  process.exit(0);
}
if (preparing || (args[0] === "proxy" && args[1] === "rg")) {
  const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "ignore" });
  fs.writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));
  setInterval(() => {}, 1000);
} else {
  process.exit(2);
}
`;
  await fs.writeFile(path.join(binPath, "rtk"), script, { mode: 0o755 });
  process.env.PATH = `${binPath}${path.delimiter}${originalPath ?? ""}`;
  return { startedPath, stoppedPath, pidPath };
}

async function waitForFile(filePath: string) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await fs.pathExists(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${path.basename(filePath)}`);
}

async function connectSearchClient(onAbort?: () => void) {
  const definition = createToolRegistry({ root: fixture.root }).spekta_rg;
  const server = new McpServer({ name: "spekta-test", version: "1.0.0" });
  server.registerTool(
    "spekta_rg",
    { inputSchema: definition.schema({}).shape },
    (args, extra) => {
      const readyPath = path.join(fixture.root, "mcp.handler-ready");
      void fs.writeFile(readyPath, String(extra.requestId));
      extra.signal.addEventListener("abort", () => onAbort?.(), { once: true });
      return definition.handler(
        args,
        undefined,
        extra.requestId,
        undefined,
        undefined,
        extra.signal,
      );
    },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "spekta-test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

describe("public MCP search interruption", () => {
  it("returns complete matches on normal backend completion", async () => {
    await fs.writeFile(
      path.join(fixture.root, "fixture.txt"),
      "needle found\n",
    );
    await installRtk("normal", fixture.root);
    const { client, server } = await connectSearchClient();
    try {
      const result = (await client.callTool({
        name: "spekta_rg",
        arguments: { patterns: ["needle"], paths: ["fixture.txt"] },
      })) as unknown as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      const text = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      expect(result.isError).toBeUndefined();
      expect(text).toContain("needle found");
      expect(text).toContain("success: Search completed with matches.");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("treats a missing RTK dependency as an engine failure, not zero matches", async () => {
    await fs.mkdir(binPath, { recursive: true });
    process.env.PATH = binPath;
    const { client, server } = await connectSearchClient();
    try {
      const result = (await client.callTool({
        name: "spekta_rg",
        arguments: { patterns: ["needle"], paths: ["."] },
      })) as unknown as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      const text = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      expect(result.isError).toBe(true);
      expect(text).toContain("internal_failure:");
      expect(text).not.toContain("No matches found.");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("cancels during backend preparation and terminates the process", async () => {
    const paths = await installRtk("preparation", fixture.root);
    const { client, server } = await connectSearchClient();
    const controller = new AbortController();
    try {
      const request = client.callTool(
        {
          name: "spekta_rg",
          arguments: { patterns: ["needle"], paths: ["."] },
        },
        undefined,
        { signal: controller.signal },
      );
      await waitForFile(path.join(fixture.root, "mcp.handler-ready"));
      await waitForFile(paths.startedPath);
      controller.abort();
      await request.catch(() => undefined);
      await waitForFile(paths.stoppedPath);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("cancels active search and reaps its descendant", async () => {
    const paths = await installRtk("search", fixture.root);
    const abortSeenPath = path.join(fixture.root, "mcp.abort-seen");
    const { client, server } = await connectSearchClient(() => {
      void fs.writeFile(abortSeenPath, "aborted");
    });
    const controller = new AbortController();
    try {
      const request = client.callTool(
        {
          name: "spekta_rg",
          arguments: { patterns: ["needle"], paths: ["."] },
        },
        undefined,
        { signal: controller.signal },
      );
      await waitForFile(path.join(fixture.root, "mcp.handler-ready"));
      await waitForFile(paths.startedPath);
      controller.abort();
      await request.catch(() => undefined);
      await waitForFile(abortSeenPath);
      await waitForFile(paths.stoppedPath);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns a distinct deadline outcome and reaps the search descendant", async () => {
    const paths = await installRtk("search", fixture.root);
    const { client, server } = await connectSearchClient();
    try {
      const result = (await client.callTool({
        name: "spekta_rg",
        arguments: {
          patterns: ["needle"],
          paths: [".", "missing-root"],
          allowance: 512,
          profile: true,
          deadline_ms: 1000,
        },
      })) as unknown as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      const text = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      expect(result.isError).toBe(true);
      expect(text).toContain("deadline_exceeded:");
      expect(text).toContain("Scope: 1/2 roots admitted; search incomplete.");
      expect(text).toContain("Operand 1: incomplete; deadline_exceeded");
      expect(text).toContain("Operand 2: unavailable; unavailable_access");
      expect(text).not.toContain("Operand 1: searched");
      expect(text).not.toContain("Timings:");
      expect(getTokenCount(text)).toBeLessThanOrEqual(512);
      await waitForFile(paths.stoppedPath);
      expect(text).not.toContain("No matches found.");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("public CLI search interruption", () => {
  it("handles a live SIGTERM and reaps the active descendant", async () => {
    const paths = await installRtk("search", fixture.root);
    const child = spawn(
      process.execPath,
      [path.resolve(process.cwd(), "dist/index.js"), "rg", "needle", "."],
      {
        cwd: fixture.root,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    try {
      await waitForFile(paths.startedPath);
      expect(child.exitCode, "CLI exited before SIGTERM").toBeNull();
      expect(child.signalCode, "CLI was signaled before SIGTERM").toBeNull();
      const delivered = child.kill("SIGTERM");
      const exitCode = await Promise.race([
        new Promise<number | null>((resolve) => child.once("close", resolve)),
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), 3000),
        ),
      ]);
      expect(exitCode).not.toBe("timeout");
      expect(
        output,
        `signal=${child.signalCode}; code=${child.exitCode}; delivered=${delivered}`,
      ).toContain("cancelled:");
      expect(output).not.toContain("No matches found.");
      await waitForFile(paths.stoppedPath);
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  });

  it("maps SIGTERM to cancellation and reaps the active descendant", async () => {
    const paths = await installRtk("search", fixture.root);
    const previousExitCode = process.exitCode;
    const output = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    process.chdir(fixture.root);
    const request = runRg(["needle", "."]);
    try {
      await waitForFile(paths.startedPath);
      process.emit("SIGTERM");
      await request;
      const text = output.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(text).toContain("cancelled:");
      expect(text).not.toContain("No matches found.");
      await waitForFile(paths.stoppedPath);
    } finally {
      output.mockRestore();
      process.exitCode = previousExitCode;
    }
  });
});
