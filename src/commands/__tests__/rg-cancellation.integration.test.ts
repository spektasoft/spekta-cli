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
  const cleanupPath = path.join(fixture.root, "test-cleanup.requested");
  await fs.writeFile(cleanupPath, "cleanup");
  const pidPaths = [
    path.join(fixture.root, "rtk.pids"),
    path.join(fixture.root, "descendant.pid"),
  ];
  for (const pidPath of pidPaths) {
    if (!(await fs.pathExists(pidPath))) continue;
    const recordedPids = (await fs.readFile(pidPath, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map(Number);
    for (const pid of new Set(recordedPids)) {
      if (
        !Number.isSafeInteger(pid) ||
        pid <= 0 ||
        pid === process.pid ||
        pid === process.ppid
      ) {
        continue;
      }
      await waitForProcessExit(pid);
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
  const invokedPath = path.join(root, "rtk.invocations");
  const rtkPidsPath = path.join(root, "rtk.pids");
  const cleanupPath = path.join(root, "test-cleanup.requested");
  const descendant = `const fs = require("node:fs"); process.on("SIGTERM", () => { fs.writeFileSync(${JSON.stringify(stoppedPath)}, "stopped"); process.exit(0); }); fs.writeFileSync(${JSON.stringify(startedPath)}, "started"); setInterval(() => { if (fs.existsSync(${JSON.stringify(cleanupPath)})) process.exit(0); }, 50);`;
  const script = `
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(invokedPath)}, JSON.stringify(args) + "\\n");
const preparing = args[0] === "proxy" && args[1] === "rg" && args.includes("--version");
if (args.length === 1 && args[0] === "--version") { console.log("rtk 1"); process.exit(0); }
if (preparing && ${JSON.stringify(mode)} !== "preparation") { console.log("ripgrep 1"); process.exit(0); }
if (args.includes("--files") && ${JSON.stringify(mode)} === "search") process.exit(0);
if (args.includes("--files") && ${JSON.stringify(mode)} === "normal") { process.stdout.write("real.txt\\0", () => process.exit(0)); }
if (args[0] === "proxy" && args[1] === "rg" && args.includes("--json") && ${JSON.stringify(mode)} === "normal") {
  process.stdout.write(JSON.stringify({ type: "match", data: { path: { text: ${JSON.stringify(path.join(root, "real.txt"))} }, line_number: 1, submatches: [{ start: 0 }], lines: { text: "needle INTERNAL\\n" } } }) + "\\n", () => process.exit(0));
}
if (preparing || (args[0] === "proxy" && args[1] === "rg")) {
  fs.appendFileSync(${JSON.stringify(rtkPidsPath)}, String(process.pid) + "\\n");
  const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "ignore" });
  fs.writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));
  setInterval(() => { if (fs.existsSync(${JSON.stringify(cleanupPath)})) process.exit(0); }, 50);
} else {
  process.exit(2);
}
`;
  if (process.platform === "win32") {
    await fs.writeFile(path.join(binPath, "rtk.js"), script);
    await fs.writeFile(
      path.join(binPath, "rtk.cmd"),
      `@echo off\r\n"${process.execPath}" "%~dp0rtk.js" %*\r\n`,
    );
  } else {
    await fs.writeFile(
      path.join(binPath, "rtk"),
      `#!${process.execPath}\n${script}`,
      {
        mode: 0o755,
      },
    );
  }
  process.env.PATH = `${binPath}${path.delimiter}${originalPath ?? ""}`;
  return { startedPath, stoppedPath, pidPath, invokedPath };
}

async function waitForFile(filePath: string) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await fs.pathExists(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${path.basename(filePath)}`);
}

async function waitForFakeRtk(invokedPath: string) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await fs.pathExists(invokedPath)) {
      const invocations = (await fs.readFile(invokedPath, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
      if (invocations.some((args) => args[0] === "proxy" && args[1] === "rg")) {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the fake RTK proxy invocation");
}

async function waitForProcessExit(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("Invalid process PID recorded by the fake backend");
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for descendant process ${pid} to exit`);
}

async function assertDescendantWasReaped(paths: {
  pidPath: string;
  stoppedPath: string;
}) {
  if (process.platform !== "win32") await waitForFile(paths.stoppedPath);
  await waitForFile(paths.pidPath);
  await waitForProcessExit(Number(await fs.readFile(paths.pidPath, "utf8")));
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
    const paths = await installRtk("normal", fixture.root);
    const { client, server } = await connectSearchClient();
    try {
      const result = (await client.callTool({
        name: "spekta_rg",
        arguments: { patterns: ["needle"], paths: ["real.txt"] },
      })) as unknown as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      const text = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      await waitForFakeRtk(paths.invokedPath);
      expect(result.isError).toBeUndefined();
      expect(text).toContain("needle INTERNAL");
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
      await waitForFakeRtk(paths.invokedPath);
      await waitForFile(paths.startedPath);
      controller.abort();
      await request.catch(() => undefined);
      await assertDescendantWasReaped(paths);
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
      await waitForFakeRtk(paths.invokedPath);
      await waitForFile(paths.startedPath);
      controller.abort();
      await request.catch(() => undefined);
      await waitForFile(abortSeenPath);
      await assertDescendantWasReaped(paths);
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
      await waitForFakeRtk(paths.invokedPath);
      expect(result.isError).toBe(true);
      expect(text).toContain("deadline_exceeded:");
      expect(text).toContain("Scope: 1/2 roots admitted; search incomplete.");
      expect(text).toContain("Operand 1: incomplete; deadline_exceeded");
      expect(text).toContain("Operand 2: unavailable; unavailable_access");
      expect(text).not.toContain("Operand 1: searched");
      expect(text).not.toContain("Timings:");
      expect(getTokenCount(text)).toBeLessThanOrEqual(512);
      await assertDescendantWasReaped(paths);
      expect(text).not.toContain("No matches found.");
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("public CLI search interruption", () => {
  it.skipIf(process.platform === "win32")(
    "handles a live SIGTERM and reaps the active descendant",
    async () => {
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
        await waitForFakeRtk(paths.invokedPath);
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
        await assertDescendantWasReaped(paths);
      } finally {
        if (child.exitCode === null) child.kill("SIGKILL");
      }
    },
  );

  it("maps SIGTERM to cancellation and reaps the active descendant", async () => {
    const paths = await installRtk("search", fixture.root);
    const previousExitCode = process.exitCode;
    const output = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const once = vi.spyOn(process, "once");
    process.chdir(fixture.root);
    const request = runRg(["needle", "."]);
    try {
      await waitForFakeRtk(paths.invokedPath);
      await waitForFile(paths.startedPath);
      const registration = once.mock.calls.findLast(
        ([event]) => event === "SIGTERM",
      );
      expect(
        registration,
        "runRg did not register a SIGTERM handler",
      ).toBeDefined();
      once.mockRestore();
      (registration?.[1] as () => void)();
      await request;
      const text = output.mock.calls.map(([chunk]) => String(chunk)).join("");
      expect(text).toContain("cancelled:");
      expect(text).not.toContain("No matches found.");
      await assertDescendantWasReaped(paths);
    } finally {
      once.mockRestore();
      output.mockRestore();
      process.exitCode = previousExitCode;
    }
  });
});
