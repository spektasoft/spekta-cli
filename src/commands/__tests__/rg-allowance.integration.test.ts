import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import readline from "node:readline";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { encode } from "gpt-tokenizer";
import { resolveAllowanceSettings } from "../../core/config/allowance";
import { getGrepResponseTokenCount } from "../grep-output-parser";
import { MAX_ALLOWANCE_REJECTION_DIAGNOSTIC_TOKENS } from "../grep-search";
import { createToolRegistry } from "../../api/mcp-server/registry";

afterEach(() => {
  vi.unstubAllEnvs();
});

async function createStdioSearchProcess() {
  const entry = process.env.SPEKTA_T09_ENTRY;
  const rg = process.env.SPEKTA_T09_RG;
  if (!entry || !rg)
    throw new Error("SPEKTA_T09_ENTRY and SPEKTA_T09_RG are required");

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rg-stdio-allowance-"));
  const workspace = path.join(root, "workspace");
  const home = path.join(root, "home");
  const assets = path.join(root, "assets");
  const bin = path.join(root, "bin");
  const rtkLog = path.join(root, "rtk.log");
  const appStderr = path.join(root, "app.stderr");
  const runtimeCapture: Array<Record<string, unknown>> = [];

  const sanitizeInput = (args: Record<string, unknown>) => ({
    ...args,
    ...(Array.isArray(args.paths)
      ? {
          paths: args.paths.map((searchPath: unknown) =>
            searchPath === ".env" ? "[protected target]" : searchPath,
          ),
        }
      : {}),
  });

  const allowanceBudget = (raw: unknown, rejected: boolean) => {
    if (
      rejected ||
      typeof raw !== "number" ||
      !Number.isSafeInteger(raw) ||
      raw <= 0 ||
      raw > 16000
    ) {
      return 2000;
    }
    return raw;
  };
  await fs.ensureDir(path.join(workspace, "src"));
  await fs.ensureDir(path.join(workspace, "src", "many"));
  await fs.ensureDir(home);
  await fs.ensureDir(bin);
  await fs.copy(
    path.join(path.dirname(entry), "templates"),
    path.join(assets, "templates"),
  );
  await fs.writeFile(
    path.join(workspace, "src", "example.ts"),
    'const needle = "safe match";\n',
  );
  await fs.writeFile(
    path.join(workspace, "src", "near.ts"),
    `${Array.from({ length: 30 }, (_, index) => `const needle${index} = ${index};`).join("\n")}\n`,
  );
  await fs.writeFile(
    path.join(workspace, "src", "failure.ts"),
    'const needle = "buffered private match";\n',
  );
  await fs.writeFile(
    path.join(workspace, "src", "bulk.ts"),
    `${Array.from({ length: 501 }, (_, index) => `needle ${index}`).join("\n")}\n`,
  );
  await Promise.all(
    Array.from({ length: 101 }, (_, index) =>
      fs.writeFile(
        path.join(workspace, "src", "many", `file-${index}.ts`),
        `const needle${index} = ${index};\n`,
      ),
    ),
  );
  await fs.writeFile(path.join(workspace, ".env"), "needle protected secret\n");
  const wrapper = `#!/bin/sh
printf '%s\\n' "$*" >> "$RTK_LOG"
if [ "$1" = "--version" ]; then echo 'rtk test'; exit 0; fi
if [ "$1" = "proxy" ] && [ "$2" = "rg" ] && [ "$3" = "--version" ]; then echo 'ripgrep test'; exit 0; fi
if [ "$1" = "proxy" ] && [ "$2" = "rg" ]; then
  case "$*" in
    *failure.ts*)
      printf '%s\\n' '{"type":"match","data":{"path":{"text":"src/failure.ts"},"line_number":1,"submatches":[{"start":6}],"lines":{"text":"needle buffered private match\\n"}}}'
      printf 'private engine detail\\n' >&2
      exit 2
      ;;
  esac
  shift 2
  exec "$RG_BIN" "$@"
fi
exit 2
`;
  await fs.writeFile(path.join(bin, "rtk"), wrapper, { mode: 0o755 });

  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const launchEnv = {
    ...process.env,
    PATH: `${bin}:${path.dirname(process.execPath)}:${path.dirname(rg)}:/usr/bin:/bin`,
    RG_BIN: rg,
    RTK_LOG: rtkLog,
    SPEKTA_HOME_OVERRIDE: home,
    SPEKTA_ASSET_ROOT_OVERRIDE: assets,
    SPEKTA_GREP_TOKEN_LIMIT: "2000",
    SPEKTA_GREP_TOKEN_CEILING: "16000",
    SPEKTA_NO_EDITOR: "1",
  };
  const command = `stty -echo -icanon; exec ${quote(process.execPath)} ${quote(entry)} mcp 2> ${quote(appStderr)}`;
  const child = spawn(
    "/usr/bin/script",
    ["-q", "-f", "-e", "-c", command, "/dev/null"],
    {
      cwd: workspace,
      env: launchEnv,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    },
  );
  const close = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const pending = new Map<
    string,
    (response: { line: string; message: Record<string, unknown> }) => void
  >();
  const reader = readline.createInterface({ input: child.stdout });
  reader.on("line", (rawLine) => {
    const line = rawLine.replace(/\r$/, "");
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (
      typeof message.method === "string" ||
      (typeof message.id !== "string" && typeof message.id !== "number")
    )
      return;
    const id = String(message.id);
    const resolve = pending.get(id);
    if (resolve) {
      pending.delete(id);
      resolve({ line, message });
    }
  });
  const send = (request: Record<string, unknown>) => {
    const id = String(request.id);
    const response = new Promise<{
      line: string;
      message: Record<string, unknown>;
    }>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP response timed out for ${id.slice(0, 40)}`));
      }, 10000);
      pending.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
    child.stdin.write(`${JSON.stringify(request)}\n`);
    return response;
  };
  const initialize = await send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "ticket09-process-test", version: "1.0.0" },
    },
  });
  expect(initialize.message.result).toBeDefined();
  child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  const tools = await send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });
  const toolsResult = tools.message.result as {
    tools: Array<{ name: string }>;
  };
  expect(toolsResult.tools.some((tool) => tool.name === "spekta_rg")).toBe(
    true,
  );

  return {
    root,
    entry,
    workspace,
    launchEnv,
    rtkLog,
    appStderr,
    send,
    async call(id: string | number, args: Record<string, unknown>) {
      const result = await send({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "spekta_rg", arguments: args },
      });
      const body = result.message.result as {
        isError?: boolean;
        content: Array<{ type: string; text: string }>;
      };
      const response = {
        ...result,
        body,
        text: body.content[0].text,
        tokens: encode(`${result.line}\n`).length,
      };
      const requestIdText = String(id);
      const isRejectedAllowance =
        typeof args.allowance !== "number" ||
        !Number.isSafeInteger(args.allowance) ||
        args.allowance <= 0 ||
        args.allowance > 16000 ||
        response.text.includes("Allowance is too small");
      const requestIdEvidence =
        requestIdText.length > 128
          ? {
              representation: "summary, not a complete wire ID",
              type: typeof id,
              length: requestIdText.length,
              sha256: createHash("sha256").update(requestIdText).digest("hex"),
            }
          : { representation: "complete ID", type: typeof id, value: id };
      runtimeCapture.push({
        boundary: "mcp",
        case:
          requestIdText.length > 128
            ? args.allowance === "bad"
              ? "invalid allowance, long ID"
              : args.allowance === 1
                ? "too-small allowance, long ID"
                : args.allowance === 16001
                  ? "over-ceiling allowance, long ID"
                  : "accepted protected-target failure, long ID"
            : requestIdText,
        input: sanitizeInput(args),
        requestId: requestIdEvidence,
        ...(requestIdText.length > 128
          ? {}
          : { serializedResponse: result.message }),
        completeRenderedBody: response.text,
        renderedBodyTokenCount: encode(response.text).length,
        serializedResponseTokenCount: response.tokens,
        applicableBudgetTokens: allowanceBudget(
          args.allowance,
          isRejectedAllowance &&
            response.text.includes("Allowance is too small"),
        ),
        isError: body.isError ?? false,
        outcome: response.text.split(":")[0],
      });
      return response;
    },
    async runCli(args: string[]) {
      const stderrPath = path.join(root, `cli-${Date.now()}.stderr`);
      const cliCommand = `stty -echo -icanon -onlcr; exec ${[
        process.execPath,
        entry,
        "rg",
        ...args,
      ]
        .map(quote)
        .join(" ")} 2> ${quote(stderrPath)}`;
      const cli = spawn(
        "/usr/bin/script",
        ["-q", "-f", "-e", "-c", cliCommand, "/dev/null"],
        {
          cwd: workspace,
          env: launchEnv,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let stdout = "";
      cli.stdout
        .setEncoding("utf8")
        .on("data", (chunk: string) => (stdout += chunk));
      const exit = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        cli.once("close", (code, signal) => resolve({ code, signal }));
      });
      const stderr = await fs.readFile(stderrPath, "utf8").catch(() => "");
      const result = {
        ...exit,
        stdout,
        stderr,
        output: `${stdout}${stderr}`,
        tokens: encode(`${stdout}${stderr}`).length,
      };
      const rawAllowance = args
        .find((arg) => arg.startsWith("--allowance="))
        ?.slice("--allowance=".length);
      const numericAllowance =
        rawAllowance === undefined ? undefined : Number(rawAllowance);
      const rejectedAllowance = /usage_error:|too small/.test(stderr);
      const duplicateAllowance =
        args.filter((arg) => arg.startsWith("--allowance=")).length > 1;
      if (duplicateAllowance) {
        expect(rejectedAllowance).toBe(true);
        expect(allowanceBudget(numericAllowance, rejectedAllowance)).toBe(2000);
        expect(encode(stderr).length).toBeLessThanOrEqual(2000);
      }
      runtimeCapture.push({
        boundary: "cli",
        case: args.map((arg) => (arg === ".env" ? "[protected target]" : arg)),
        input: args.map((arg) => (arg === ".env" ? "[protected target]" : arg)),
        stdout,
        stderr,
        exitCode: exit.code,
        signal: exit.signal,
        serializedResponseTokenCount: result.tokens,
        applicableBudgetTokens: allowanceBudget(
          numericAllowance,
          rejectedAllowance,
        ),
        outcome:
          (stderr || stdout).match(
            /(?:\[ERROR\] )?(success|no_matches|usage_error|unavailable_access|internal_failure|output_limit_exceeded):/,
          )?.[1] ?? "unlabeled",
      });
      return result;
    },
    async close() {
      child.stdin.end();
      const exit = await Promise.race([
        close,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
      ]).then(async (result) => {
        if (result) return result;
        try {
          if (child.pid && process.platform !== "win32")
            process.kill(-child.pid, "SIGTERM");
          else child.kill("SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
        const afterTerm = await Promise.race([
          close,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        if (afterTerm) return afterTerm;
        try {
          if (child.pid && process.platform !== "win32")
            process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
        return await Promise.race([
          close,
          new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
            (resolve) =>
              setTimeout(() => resolve({ code: null, signal: null }), 2000),
          ),
        ]);
      });
      reader.close();
      const appStderrOutput = await fs
        .readFile(appStderr, "utf8")
        .catch(() => "");
      await fs.remove(root);
      const temporaryWorkspaceRemoved = !(await fs.pathExists(root));
      const capturePath = process.env.SPEKTA_T09_CAPTURE;
      if (capturePath) {
        await fs.ensureDir(path.dirname(capturePath));
        await fs.writeFile(
          capturePath,
          `${JSON.stringify(
            {
              entry,
              rg: launchEnv.RG_BIN,
              responseCount: runtimeCapture.length,
              responses: runtimeCapture,
              processExit: exit,
              appStderr: appStderrOutput,
              temporaryWorkspaceRemoved,
            },
            null,
            2,
          )}\n`,
        );
      }
      return exit;
    },
  };
}

describe("registered spekta_rg allowance boundary", () => {
  it("returns measured long-ID rejections and accepted operational outcomes over real stdio", async () => {
    const server = await createStdioSearchProcess();
    try {
      const longId = `long-${"x".repeat(20000)}`;
      expect(longId.length).toBe(20005);

      const malformed = await server.call(longId, {
        patterns: ["needle"],
        allowance: "bad",
      });
      expect(malformed.body.isError).toBe(true);
      expect(malformed.text).toContain("usage_error:");
      expect(encode(malformed.text).length).toBeLessThanOrEqual(
        MAX_ALLOWANCE_REJECTION_DIAGNOSTIC_TOKENS,
      );
      expect(malformed.text).not.toContain("needle");
      expect(malformed.message.id).toBe(longId);
      expect(malformed.tokens).toBeGreaterThan(2000);
      expect(malformed.tokens).toBeLessThan(5000);
      expect(Object.keys(malformed.message).sort()).toEqual([
        "id",
        "jsonrpc",
        "result",
      ]);
      expect(
        Object.keys(malformed.message.result as Record<string, unknown>).sort(),
      ).toEqual(["content", "isError"]);
      expect(getGrepResponseTokenCount(malformed.text, longId, true)).toBe(
        malformed.tokens,
      );
      expect(await fs.pathExists(server.rtkLog)).toBe(false);

      const tooSmall = await server.call(longId, {
        patterns: ["needle"],
        allowance: 1,
      });
      expect(tooSmall.body.isError).toBe(true);
      expect(tooSmall.text).toContain("output_limit_exceeded:");
      expect(tooSmall.text).toContain("too small");
      expect(tooSmall.text).not.toMatch(/increase|edit .*config|needle/i);
      expect(tooSmall.message.id).toBe(longId);
      expect(encode(tooSmall.text).length).toBeLessThanOrEqual(
        MAX_ALLOWANCE_REJECTION_DIAGNOSTIC_TOKENS,
      );
      expect(tooSmall.tokens).toBeGreaterThan(2000);
      expect(tooSmall.tokens).toBeLessThan(5000);
      expect(Object.keys(tooSmall.message).sort()).toEqual([
        "id",
        "jsonrpc",
        "result",
      ]);
      expect(
        Object.keys(tooSmall.message.result as Record<string, unknown>).sort(),
      ).toEqual(["content", "isError"]);
      expect(getGrepResponseTokenCount(tooSmall.text, longId, true)).toBe(
        tooSmall.tokens,
      );
      expect(await fs.pathExists(server.rtkLog)).toBe(false);

      const longOverCeiling = await server.call(longId, {
        patterns: ["needle"],
        allowance: 16001,
      });
      expect(longOverCeiling.body.isError).toBe(true);
      expect(longOverCeiling.text).toContain("16000 tokens");
      expect(longOverCeiling.text).not.toContain("16001");
      expect(longOverCeiling.text).not.toContain("needle");
      expect(longOverCeiling.message.id).toBe(longId);
      expect(encode(longOverCeiling.text).length).toBeLessThanOrEqual(
        MAX_ALLOWANCE_REJECTION_DIAGNOSTIC_TOKENS,
      );
      expect(longOverCeiling.tokens).toBeGreaterThan(2000);
      expect(
        getGrepResponseTokenCount(longOverCeiling.text, longId, true),
      ).toBe(longOverCeiling.tokens);
      expect(Object.keys(longOverCeiling.message).sort()).toEqual([
        "id",
        "jsonrpc",
        "result",
      ]);
      expect(await fs.pathExists(server.rtkLog)).toBe(false);
      expect(await fs.readFile(server.rtkLog, "utf8").catch(() => "")).toBe("");

      const unavailable = await server.call("protected-target", {
        patterns: ["needle"],
        paths: [".env"],
        allowance: 3500,
      });
      expect(unavailable.body.isError).toBe(true);
      expect(unavailable.text).toContain("unavailable_access:");
      expect(unavailable.text).toContain("not eligible");
      expect(unavailable.text).not.toContain(".env");
      expect(unavailable.text).not.toContain("protected secret");
      expect(unavailable.text).not.toContain("needle");
      expect(unavailable.tokens).toBeLessThanOrEqual(3500);
      expect(await fs.pathExists(server.rtkLog)).toBe(false);

      const success = await server.call("success", {
        patterns: ["needle"],
        paths: ["src/example.ts"],
        allowance: 1000,
      });
      expect(success.body.isError).toBeUndefined();
      expect(success.text).toContain("success:");
      expect(success.tokens).toBeLessThanOrEqual(1000);

      const noMatches = await server.call("no-matches", {
        patterns: ["not-present"],
        paths: ["src/example.ts"],
        allowance: 1000,
      });
      expect(noMatches.body.isError).toBeUndefined();
      expect(noMatches.text).toContain("no_matches:");
      expect(noMatches.tokens).toBeLessThanOrEqual(1000);

      const exactAllowance = getGrepResponseTokenCount(
        `Scope: 1/1 roots searched.\nOperand 1: searched\nsuccess: Search completed with matches.\n${[
          "#### src/near.ts",
          "```ts",
          ...Array.from(
            { length: 30 },
            (_, index) => `${index + 1}:6:const needle${index} = ${index};`,
          ),
          "```",
        ].join("\n")}`,
        "near-boundary",
      );
      const nearBoundary = await server.call("near-boundary", {
        patterns: ["needle"],
        paths: ["src/near.ts"],
        allowance: exactAllowance,
      });
      expect(nearBoundary.body.isError).toBeUndefined();
      expect(nearBoundary.text).toContain("success:");
      expect(nearBoundary.tokens).toBe(exactAllowance);

      const belowBoundary = await server.call("below-boundary", {
        patterns: ["needle"],
        paths: ["src/near.ts"],
        allowance: exactAllowance - 1,
      });
      expect(belowBoundary.body.isError).toBe(true);
      expect(belowBoundary.text).toContain("output_limit_exceeded:");
      expect(belowBoundary.text).not.toContain("needle0");
      expect(belowBoundary.tokens).toBeLessThanOrEqual(exactAllowance - 1);

      const overflow = await server.call("overflow", {
        patterns: ["needle"],
        paths: ["src/bulk.ts"],
        allowance: 1200,
      });
      expect(overflow.body.isError).toBe(true);
      expect(await fs.readFile(server.rtkLog, "utf8")).toContain("src/bulk.ts");
      expect(overflow.text).toContain("output_limit_exceeded:");
      expect(overflow.text).toContain("All matches withheld");
      expect(overflow.text).toContain("Recovery: Narrow path/pattern.");
      expect(overflow.text).not.toContain("needle 0");
      expect(overflow.text).not.toContain("needle 500");
      expect(overflow.text).not.toMatch(/\b\d+ matches?\b/i);
      expect(overflow.tokens).toBeLessThanOrEqual(1200);

      const matchCap = await server.call("match-cap", {
        patterns: ["needle"],
        paths: ["src/bulk.ts"],
        allowance: 16000,
      });
      expect(matchCap.body.isError).toBe(true);
      expect(matchCap.text).toContain("output_limit_exceeded:");
      expect(matchCap.text).not.toContain("needle 0");
      expect(matchCap.text).not.toContain("needle 500");
      expect(matchCap.tokens).toBeLessThanOrEqual(16000);

      const fileCap = await server.call("file-cap", {
        patterns: ["needle"],
        paths: ["src/many"],
        allowance: 16000,
      });
      expect(fileCap.body.isError).toBe(true);
      expect(fileCap.text).toContain("output_limit_exceeded:");
      expect(fileCap.text).not.toContain("file-0.ts");
      expect(fileCap.text).not.toContain("const needle0 =");
      expect(fileCap.tokens).toBeLessThanOrEqual(16000);

      const overCeiling = await server.call("over-ceiling", {
        patterns: ["needle"],
        allowance: 16001,
      });
      expect(overCeiling.body.isError).toBe(true);
      expect(overCeiling.text).toContain("16000 tokens");
      expect(encode(overCeiling.text).length).toBeLessThanOrEqual(
        MAX_ALLOWANCE_REJECTION_DIAGNOSTIC_TOKENS,
      );
      expect(overCeiling.tokens).toBeLessThanOrEqual(2000);

      const rtkBeforeRejectedAllowance = await fs.readFile(
        server.rtkLog,
        "utf8",
      );
      const malformedShortId = await server.call("malformed-short-id", {
        patterns: ["needle"],
        allowance: "bad",
      });
      expect(malformedShortId.body.isError).toBe(true);
      expect(malformedShortId.text).toContain("usage_error:");
      expect(malformedShortId.text.length).toBeGreaterThan(0);
      expect(encode(malformedShortId.text).length).toBeLessThanOrEqual(
        MAX_ALLOWANCE_REJECTION_DIAGNOSTIC_TOKENS,
      );
      expect(malformedShortId.tokens).toBeLessThanOrEqual(2000);

      const nonpositiveMcpAllowance = await server.call("mcp-zero", {
        patterns: ["needle"],
        allowance: 0,
      });
      expect(nonpositiveMcpAllowance.body.isError).toBe(true);
      expect(nonpositiveMcpAllowance.text).toContain("usage_error:");
      expect(nonpositiveMcpAllowance.text.length).toBeGreaterThan(0);
      expect(nonpositiveMcpAllowance.tokens).toBeLessThanOrEqual(2000);

      const nonintegerMcpAllowance = await server.call("mcp-fraction", {
        patterns: ["needle"],
        allowance: 1.5,
      });
      expect(nonintegerMcpAllowance.body.isError).toBe(true);
      expect(nonintegerMcpAllowance.text).toContain("usage_error:");
      expect(nonintegerMcpAllowance.text.length).toBeGreaterThan(0);
      expect(nonintegerMcpAllowance.tokens).toBeLessThanOrEqual(2000);

      const tooSmallShortId = await server.call("too-small-short-id", {
        patterns: ["needle"],
        allowance: 1,
      });
      expect(tooSmallShortId.body.isError).toBe(true);
      expect(tooSmallShortId.text).toContain("output_limit_exceeded:");
      expect(tooSmallShortId.text).toContain("too small");
      expect(tooSmallShortId.text).toContain("configured default");
      expect(tooSmallShortId.text).not.toContain("MCP request ID");
      expect(tooSmallShortId.text.length).toBeGreaterThan(0);
      expect(encode(tooSmallShortId.text).length).toBeLessThanOrEqual(
        MAX_ALLOWANCE_REJECTION_DIAGNOSTIC_TOKENS,
      );
      expect(tooSmallShortId.tokens).toBeLessThanOrEqual(2000);
      expect(tooSmallShortId.message.id).toBe("too-small-short-id");
      expect(await fs.readFile(server.rtkLog, "utf8")).toBe(
        rtkBeforeRejectedAllowance,
      );

      const engineFailure = await server.call("engine-failure", {
        patterns: ["needle"],
        paths: ["src/failure.ts"],
        allowance: 3500,
      });
      expect(engineFailure.body.isError).toBe(true);
      expect(engineFailure.text).toContain("internal_failure:");
      expect(engineFailure.text).not.toContain("failure.ts");
      expect(engineFailure.text).not.toContain("buffered private match");
      expect(engineFailure.text).not.toContain("private engine detail");
      expect(engineFailure.tokens).toBeLessThanOrEqual(3500);
      expect(await fs.readFile(server.rtkLog, "utf8")).toContain(
        "src/failure.ts",
      );
      expect(await fs.readFile(server.appStderr, "utf8")).toBe("");

      const cliSuccess = await server.runCli([
        "--allowance=1000",
        "needle",
        "src/example.ts",
      ]);
      expect(cliSuccess.code).toBe(0);
      expect(cliSuccess.output).toContain(
        "success: Search completed with matches.",
      );
      expect(cliSuccess.tokens).toBeLessThanOrEqual(1000);

      const cliMixed = await server.runCli([
        "--allowance=1200",
        "-e",
        "needle",
        "src/example.ts",
        ".env",
      ]);
      expect(cliMixed.code).toBe(1);
      expect(cliMixed.output).toContain("Batch: partial_result");
      expect(cliMixed.output).toContain(
        "Operand 2: unavailable; unavailable_access",
      );
      expect(cliMixed.output).toContain("safe match");
      expect(cliMixed.output).not.toContain(".env");
      expect(cliMixed.output).not.toContain("protected secret");
      const mcpMixed = await server.call("mixed-transport", {
        patterns: ["needle"],
        paths: ["src/example.ts", ".env"],
        allowance: 1200,
      });
      expect(mcpMixed.body.isError).toBe(true);
      expect(mcpMixed.text).toContain("Batch: partial_result");
      expect(mcpMixed.text).toContain(
        "Operand 2: unavailable; unavailable_access",
      );
      expect(mcpMixed.text).toContain("safe match");
      expect(mcpMixed.text).not.toContain(".env");
      expect(mcpMixed.tokens).toBe(encode(`${mcpMixed.line}\n`).length);
      expect(mcpMixed.tokens).toBeLessThanOrEqual(1200);

      const cliMixedOverflow = await server.runCli([
        "--allowance=1200",
        "-e",
        "needle",
        "src/bulk.ts",
        ".env",
      ]);
      expect(cliMixedOverflow.code).toBe(1);
      expect(cliMixedOverflow.stderr).toContain("All matches withheld");
      expect(cliMixedOverflow.stderr).toContain(
        "Requested scope is incomplete",
      );
      expect(cliMixedOverflow.output).not.toContain("needle 0");
      expect(cliMixedOverflow.output).not.toContain(".env");
      const mcpMixedOverflow = await server.call("mixed-overflow-transport", {
        patterns: ["needle"],
        paths: ["src/bulk.ts", ".env"],
        allowance: 1200,
      });
      expect(mcpMixedOverflow.body.isError).toBe(true);
      expect(mcpMixedOverflow.text).toContain("All matches withheld");
      expect(mcpMixedOverflow.text).toContain("Requested scope is incomplete");
      expect(mcpMixedOverflow.text).not.toContain("needle 0");
      expect(mcpMixedOverflow.text).not.toContain(".env");
      expect(mcpMixedOverflow.tokens).toBe(
        encode(`${mcpMixedOverflow.line}\n`).length,
      );
      expect(mcpMixedOverflow.tokens).toBeLessThanOrEqual(1200);

      const cliNearSizing = await server.runCli([
        "--allowance=16000",
        "needle",
        "src/near.ts",
      ]);
      expect(cliNearSizing.code).toBe(0);
      const cliNearExact = await server.runCli([
        `--allowance=${cliNearSizing.tokens}`,
        "needle",
        "src/near.ts",
      ]);
      expect(cliNearExact.code).toBe(0);
      expect(cliNearExact.output).toBe(cliNearSizing.output);
      expect(cliNearExact.tokens).toBe(cliNearSizing.tokens);
      const cliNearUnder = await server.runCli([
        `--allowance=${cliNearSizing.tokens - 1}`,
        "needle",
        "src/near.ts",
      ]);
      expect(cliNearUnder.code).toBe(1);
      expect(cliNearUnder.stderr).toContain("output_limit_exceeded:");
      expect(cliNearUnder.output).not.toContain("needle0");

      const cliNoMatches = await server.runCli([
        "not-present",
        "src/example.ts",
      ]);
      expect(cliNoMatches.code).toBe(0);
      expect(cliNoMatches.output).toContain("no_matches: No matches found.");

      const cliOverflow = await server.runCli([
        "--allowance=100",
        "needle",
        "src/bulk.ts",
      ]);
      expect(cliOverflow.code).toBe(1);
      expect(cliOverflow.stderr).toContain("output_limit_exceeded:");
      expect(cliOverflow.stderr).not.toContain("needle 0");
      expect(cliOverflow.stderr).not.toMatch(/\b\d+ matches?\b/i);
      expect(cliOverflow.tokens).toBeLessThanOrEqual(100);

      const cliInvalid = await server.runCli(["--allowance=bad", "needle"]);
      expect(cliInvalid.code).toBe(1);
      expect(cliInvalid.stderr).toContain("usage_error:");

      for (const args of [
        ["--allowance=0", "needle"],
        ["--allowance=1.5", "needle"],
        ["--allowance=1", "--allowance=2", "needle"],
      ]) {
        const rejected = await server.runCli(args);
        expect(rejected.code).toBe(1);
        expect(rejected.stderr).toContain("usage_error:");
        expect(rejected.stderr.trim()).not.toBe("");
      }

      const cliOverCeiling = await server.runCli([
        "--allowance=16001",
        "needle",
      ]);
      expect(cliOverCeiling.code).toBe(1);
      expect(cliOverCeiling.stderr).toContain("16000 tokens");

      const cliTooSmall = await server.runCli(["--allowance=1", "needle"]);
      expect(cliTooSmall.code).toBe(1);
      expect(cliTooSmall.stderr).toContain("too small");
      expect(cliTooSmall.stderr).toContain("configured default");
      expect(cliTooSmall.stderr).not.toContain("MCP request ID");
      expect(cliTooSmall.stderr.trim()).not.toBe("");

      for (const args of [
        ["--json", "needle"],
        ["-e", " ", "src"],
      ]) {
        const unsupported = await server.runCli(args);
        expect(unsupported.code).toBe(1);
        expect(unsupported.stderr).toContain("usage_error:");
        expect(unsupported.stderr.trim()).not.toBe("");
      }

      const cliMatchCap = await server.runCli([
        "--allowance=16000",
        "needle",
        "src/bulk.ts",
      ]);
      expect(cliMatchCap.code).toBe(1);
      expect(cliMatchCap.stderr).toContain("output_limit_exceeded:");
      expect(cliMatchCap.output).not.toContain("needle 0");

      const cliFileCap = await server.runCli([
        "--allowance=16000",
        "needle",
        "src/many",
      ]);
      expect(cliFileCap.code).toBe(1);
      expect(cliFileCap.stderr).toContain("output_limit_exceeded:");
      expect(cliFileCap.output).not.toContain("file-0.ts");

      const cliProtected = await server.runCli(["needle", ".env"]);
      expect(cliProtected.code).toBe(1);
      expect(cliProtected.stderr).toContain("unavailable_access:");
      expect(cliProtected.stderr).not.toContain(".env");
      expect(cliProtected.stderr).not.toContain("protected secret");

      const cliFailure = await server.runCli([
        "--allowance=3500",
        "needle",
        "src/failure.ts",
      ]);
      expect(cliFailure.code).toBe(1);
      expect(cliFailure.stderr).toContain("internal_failure:");
      expect(cliFailure.stderr).not.toContain("failure.ts");
      expect(cliFailure.stderr).not.toContain("buffered private match");
      expect(cliFailure.stderr).not.toContain("private engine detail");
    } finally {
      const exit = await server.close();
      expect(exit.code !== null || exit.signal !== null).toBe(true);
      await fs.remove(server.root);
      expect(await fs.pathExists(server.root)).toBe(false);
    }
  }, 60000);

  it("returns bounded public failures for malformed and over-ceiling allowances", async () => {
    vi.stubEnv("SPEKTA_GREP_TOKEN_LIMIT", "1000");
    vi.stubEnv("SPEKTA_GREP_TOKEN_CEILING", "2000");
    const definition = createToolRegistry({ root: process.cwd() }).spekta_rg;
    const server = new McpServer({ name: "spekta-test", version: "1.0.0" });
    server.registerTool(
      "spekta_rg",
      { inputSchema: definition.schema({}).shape },
      (args, extra) => definition.handler(args, undefined, extra.requestId),
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const sentResponses: Array<Record<string, unknown>> = [];
    const serverSend = serverTransport.send.bind(serverTransport);
    serverTransport.send = async (message, options) => {
      if ("id" in message && "result" in message) sentResponses.push(message);
      return serverSend(message, options);
    };
    const client = new Client({ name: "spekta-test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const malformed = await client.callTool({
        name: "spekta_rg",
        arguments: { patterns: ["needle"], allowance: "bad" },
      });
      const malformedResponse = sentResponses.at(-1) as {
        result: { isError?: boolean; content: Array<{ text: string }> };
      };
      expect(malformed.isError).toBe(true);
      expect(malformedResponse.result.isError).toBe(true);
      expect(malformedResponse.result.content[0].text).toContain(
        "usage_error:",
      );
      expect(
        getGrepResponseTokenCount(
          malformedResponse.result.content[0].text,
          (sentResponses.at(-1) as { id: string | number }).id,
          true,
        ),
      ).toBeLessThanOrEqual(resolveAllowanceSettings("search").defaultTokens);

      const metadataTooSmall = await client.callTool({
        name: "spekta_rg",
        arguments: { patterns: ["needle"], allowance: 1 },
      });
      const smallResponse = sentResponses.at(-1) as {
        id: string | number;
        result: { isError?: boolean; content: Array<{ text: string }> };
      };
      expect(metadataTooSmall.isError).toBe(true);
      expect(smallResponse.result.content[0].text).toContain(
        "output_limit_exceeded:",
      );
      expect(smallResponse.result.content[0].text).toContain("too small");
      expect(
        getGrepResponseTokenCount(
          smallResponse.result.content[0].text,
          smallResponse.id,
          true,
        ),
      ).toBeLessThanOrEqual(resolveAllowanceSettings("search").defaultTokens);

      const exactCeiling = await client.callTool({
        name: "spekta_rg",
        arguments: { patterns: ["needle"], paths: ["/"], allowance: 2000 },
      });
      const acceptedResponse = sentResponses.at(-1) as {
        id: string | number;
        result: { isError?: boolean; content: Array<{ text: string }> };
      };
      expect(exactCeiling.isError).toBe(true);
      expect(acceptedResponse.result.isError).toBe(true);
      expect(acceptedResponse.result.content[0].text).toContain(
        "unavailable_access:",
      );
      expect(
        getGrepResponseTokenCount(
          acceptedResponse.result.content[0].text,
          acceptedResponse.id,
          true,
        ),
      ).toBeLessThanOrEqual(2000);

      const excessive = await client.callTool({
        name: "spekta_rg",
        arguments: { patterns: ["needle"], allowance: 2001 },
      });
      const excessiveResponse = sentResponses.at(-1) as {
        id: string | number;
        result: { isError?: boolean; content: Array<{ text: string }> };
      };
      expect(excessive.isError).toBe(true);
      expect(excessiveResponse.result.isError).toBe(true);
      expect(excessiveResponse.result.content[0].text).toContain(
        "output_limit_exceeded:",
      );
      expect(excessiveResponse.result.content[0].text).toContain("2000 tokens");
      expect(
        getGrepResponseTokenCount(
          excessiveResponse.result.content[0].text,
          excessiveResponse.id,
          true,
        ),
      ).toBeLessThanOrEqual(resolveAllowanceSettings("search").defaultTokens);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns a bounded registered MCP engine failure after buffered output", async () => {
    vi.stubEnv("SPEKTA_GREP_TOKEN_LIMIT", "1000");
    vi.stubEnv("SPEKTA_GREP_TOKEN_CEILING", "2000");
    const binPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "rg-mcp-engine-failure-"),
    );
    const matchLine = JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/commands/rg.ts" },
        line_number: 1,
        submatches: [{ start: 0 }],
        lines: { text: "needle buffered private match\n" },
      },
    });
    await fs.writeFile(
      path.join(binPath, "rtk"),
      `#!/bin/sh
if [ "$1" = "--version" ]; then exit 0; fi
if [ "$1" = "proxy" ] && [ "$2" = "rg" ] && [ "$3" = "--version" ]; then exit 0; fi
if [ "$1" = "proxy" ] && [ "$2" = "rg" ]; then
  printf '%s\\n' '${matchLine}'
  printf 'private engine detail\\n' >&2
  exit 2
fi
exit 2
`,
      { mode: 0o755 },
    );
    vi.stubEnv("PATH", `${binPath}${path.delimiter}${process.env.PATH ?? ""}`);

    const definition = createToolRegistry({ root: process.cwd() }).spekta_rg;
    const server = new McpServer({ name: "spekta-test", version: "1.0.0" });
    server.registerTool(
      "spekta_rg",
      { inputSchema: definition.schema({}).shape },
      (args, extra) => definition.handler(args, undefined, extra.requestId),
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const sentResponses: Array<Record<string, unknown>> = [];
    const serverSend = serverTransport.send.bind(serverTransport);
    serverTransport.send = async (message, options) => {
      if ("id" in message && "result" in message) sentResponses.push(message);
      return serverSend(message, options);
    };
    const client = new Client({ name: "spekta-test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: "spekta_rg",
        arguments: { patterns: ["needle"], paths: ["src/commands/rg.ts"] },
      });
      const response = sentResponses.at(-1) as {
        id: string | number;
        result: { isError?: boolean; content: Array<{ text: string }> };
      };
      const text = response.result.content[0].text;
      expect(result.isError).toBe(true);
      expect(response.result.isError).toBe(true);
      expect(text).toContain("internal_failure:");
      expect(text).not.toContain("src/commands/rg.ts");
      expect(text).not.toContain("buffered private match");
      expect(text).not.toContain("private engine detail");
      expect(
        getGrepResponseTokenCount(text, response.id, true),
      ).toBeLessThanOrEqual(1000);
    } finally {
      await client.close();
      await server.close();
      await fs.remove(binPath);
    }
  });
});
