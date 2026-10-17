import fs from "fs-extra";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToolRegistry } from "../../api/mcp-server/registry";
import { dispatchCommand } from "../../cli/commands";
import { getTokenCount } from "../../utils/read-utils";

type Transport = "cli" | "mcp";
interface Invocation {
  text: string;
  failed: boolean;
  rendered: string;
  serialized: string;
  requestId?: string | number;
}

function noisySegment(length: number): string {
  return randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length);
}

let tempRoot: string;
let workspace: string;
let bin: string;
let marker: string;
let probeMarker: string;
let savedCwd: string;
let savedExitCode: typeof process.exitCode;
const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

beforeEach(async () => {
  savedCwd = process.cwd();
  savedExitCode = process.exitCode;
  process.exitCode = undefined;
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spekta-find-public-"));
  workspace = path.join(tempRoot, "workspace");
  bin = path.join(tempRoot, "bin");
  marker = path.join(tempRoot, "rtk-invocations.jsonl");
  probeMarker = path.join(tempRoot, "rtk-probes.jsonl");
  await fs.ensureDir(workspace);
  await fs.ensureDir(bin);
  await installFakeRtk();
  process.chdir(workspace);
  vi.stubEnv("PATH", bin);
  vi.stubEnv("SPEKTA_HOME_OVERRIDE", path.join(tempRoot, "home"));
  vi.stubEnv("SPEKTA_ASSET_ROOT_OVERRIDE", repository);
  vi.stubEnv("SPEKTA_LIST_TOKEN_LIMIT", "1000");
  vi.stubEnv("SPEKTA_LIST_TOKEN_CEILING", "8000");
});

afterEach(async () => {
  process.chdir(savedCwd);
  process.exitCode = savedExitCode;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.remove(tempRoot);
});

async function installFakeRtk(): Promise<void> {
  const script = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "--version") { fs.appendFileSync(process.env.SPEKTA_RTK_PROBE_MARKER, "probe\\n"); process.stdout.write("rtk 0.50.0\\n"); process.exit(0); }
if (args[0] !== "proxy" || args[1] !== "find") process.exit(2);
fs.appendFileSync(process.env.SPEKTA_FIND_MARKER, JSON.stringify(args) + "\\n");
const root = args[3] || ".";
if (root === "fail") { process.stderr.write("PRIVATE_STDERR_MARKER"); process.exit(7); }
const typeIndex = args.indexOf("-type");
const wantedType = typeIndex < 0 ? undefined : args[typeIndex + 1];
const nameIndex = args.indexOf("-name");
const pattern = nameIndex < 0 ? undefined : args[nameIndex + 1];
const matchesName = (name) => pattern === undefined || pattern === "*" || (pattern.startsWith("*.") ? name.endsWith(pattern.slice(1)) : name === pattern);
const found = [];
function visit(current, relative) {
  const stat = fs.lstatSync(current);
  const isDirectory = stat.isDirectory() && !stat.isSymbolicLink();
  if ((!wantedType || (wantedType === "d" && isDirectory) || (wantedType === "f" && stat.isFile())) && matchesName(path.basename(current))) found.push(relative || ".");
  if (!isDirectory || stat.isSymbolicLink()) return;
  for (const entry of fs.readdirSync(current).sort()) {
    const child = path.join(current, entry);
    const childRelative = path.join(relative, entry);
    const childStat = fs.lstatSync(child);
    if (childStat.isSymbolicLink()) {
      if ((!wantedType || wantedType === "d") && matchesName(entry)) found.push(childRelative);
      continue;
    }
    visit(child, childRelative);
  }
}
visit(path.resolve(process.cwd(), root), root === "." ? "." : root);
const output = found.join("\\n") + (found.length ? "\\n" : "");
fs.writeSync(1, output);
`;
  await fs.writeFile(path.join(bin, "package.json"), '{"type":"commonjs"}');
  await fs.writeFile(path.join(bin, "rtk"), script, { mode: 0o755 });
}

function bodyFromCli(rendered: string): string {
  const match = rendered.match(/```\n([\s\S]*?)\n```/);
  expect(match).not.toBeNull();
  return match![1];
}

function mcpEnvelope(
  requestId: string | number,
  text: string,
  isError: boolean,
): string {
  return (
    JSON.stringify({
      jsonrpc: "2.0",
      id: requestId,
      result: { isError, content: [{ type: "text", text }] },
    }) + "\n"
  );
}

async function invoke(
  transport: Transport,
  args: string[],
  options: { requestId?: string | number; allowance?: unknown } = {},
): Promise<Invocation> {
  process.exitCode = undefined;
  vi.stubEnv("SPEKTA_FIND_MARKER", marker);
  vi.stubEnv("SPEKTA_RTK_PROBE_MARKER", probeMarker);
  if (transport === "cli") {
    let output = "";
    let errorOutput = "";
    const log = vi.spyOn(console, "log").mockImplementation((...items) => {
      output += `${items.join(" ")}\n`;
    });
    const error = vi.spyOn(console, "error").mockImplementation((...items) => {
      errorOutput += `${items.join(" ")}\n`;
    });
    try {
      await dispatchCommand("find", args);
      const rendered = output || errorOutput;
      const text = output ? bodyFromCli(output) : errorOutput.trimEnd();
      return {
        text,
        failed: process.exitCode === 1,
        rendered,
        serialized: rendered,
      };
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  }

  const requestId = options.requestId ?? "public-find/acceptance-17";
  const registry = createToolRegistry({ root: workspace });
  const result = await registry.spekta_shell.handler(
    {
      command: "find",
      args,
      ...(options.allowance === undefined
        ? {}
        : { allowance: options.allowance }),
    },
    undefined,
    requestId,
  );
  const text = result.content[0]?.text ?? "";
  return {
    text,
    failed: result.isError === true,
    rendered: text,
    serialized: mcpEnvelope(requestId, text, result.isError === true),
    requestId,
  };
}

function expectParity(cli: Invocation, mcp: Invocation): void {
  expect(mcp.text).toBe(cli.text);
  expect(mcp.failed).toBe(cli.failed);
  expect(mcp.serialized).toContain('"jsonrpc":"2.0"');
  expect(mcp.serialized).toContain('"id":"public-find/acceptance-17"');
}

async function readCalls(): Promise<string[][]> {
  if (!(await fs.pathExists(marker))) return [];
  return (await fs.readFile(marker, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

async function readProbeCount(): Promise<number> {
  if (!(await fs.pathExists(probeMarker))) return 0;
  return (await fs.readFile(probeMarker, "utf8")).split("\n").filter(Boolean)
    .length;
}

describe.each(["cli", "mcp"] as const)("public find over %s", (transport) => {
  it("covers default, explicit, multiple, duplicate roots and supplied order", async () => {
    await fs.ensureDir(path.join(workspace, "first"));
    await fs.ensureDir(path.join(workspace, "second"));
    for (const name of ["first/one.ts", "second/two.ts"])
      await fs.writeFile(path.join(workspace, name), "x");

    const defaults = await invoke(transport, ["-type", "f"]);
    const explicit = await invoke(transport, [".", "-type", "f"]);
    const multiple = await invoke(transport, [
      "second",
      "first",
      "second",
      "-type",
      "f",
    ]);
    expect(defaults.text).toContain('Operand 1: returned; "."');
    expect(explicit.text).toContain('Operand 1: returned; "."');
    expect(multiple.text.indexOf('Operand 1: returned; "second"')).toBeLessThan(
      multiple.text.indexOf('Operand 2: returned; "first"'),
    );
    expect((await readCalls()).map((call) => call[3])).toEqual([
      ".",
      ".",
      "second",
      "first",
      "second",
    ]);
    expect(multiple.text.match(/"second\/two\.ts"/g)).toHaveLength(2);
  });

  it("keeps eligible siblings when missing, protected, ignored, outside, file, or escaping roots are unavailable", async () => {
    await fs.ensureDir(path.join(workspace, "good"));
    await fs.writeFile(path.join(workspace, "good", "keep.ts"), "x");
    await fs.ensureDir(path.join(workspace, ".env"));
    await fs.ensureDir(path.join(workspace, "ignored"));
    await fs.writeFile(path.join(workspace, ".spektaignore"), "ignored/\n");
    await fs.writeFile(path.join(workspace, "file-root"), "x");
    const outside = path.join(tempRoot, "outside-protected-canonical-target");
    await fs.ensureDir(outside);
    await fs.symlink(outside, path.join(workspace, "escape"));
    const veryLongMissing = `missing-${"protected-".repeat(140)}`;
    const roots = [
      veryLongMissing,
      "missing-secret",
      ".env",
      "ignored",
      outside,
      "file-root",
      "escape",
    ];
    const results: Invocation[] = [];
    for (const root of roots)
      results.push(await invoke(transport, [root, "good", "-type", "f"]));
    expect(new Set(results.map((result) => result.text)).size).toBe(1);
    const output = results[0].text;
    expect(output).toContain("Operand 1: unavailable; unavailable_access");
    expect(output).toContain('Operand 2: returned; "good"');
    expect(output).toContain('"good/keep.ts"');
    for (const secret of [
      ...roots,
      outside,
      "outside-protected-canonical-target",
    ])
      expect(output).not.toContain(secret);
    const calls = await readCalls();
    expect(calls.map((call) => call[3])).toEqual(
      Array(roots.length).fill("good"),
    );
  });

  it("uses identical empty wording for empty and excluded-only roots", async () => {
    await fs.ensureDir(path.join(workspace, "empty"));
    await fs.ensureDir(path.join(workspace, "excluded"));
    await fs.writeFile(
      path.join(workspace, "excluded", "private-hidden.ts"),
      "x",
    );
    await fs.writeFile(
      path.join(workspace, ".spektaignore"),
      "private-hidden.ts\n",
    );
    const empty = await invoke(transport, ["empty", "-type", "f"]);
    const excluded = await invoke(transport, ["excluded", "-type", "f"]);
    expect(empty.text.replace('"empty"', '"excluded"')).toBe(excluded.text);
    expect(empty.text).toContain("No eligible paths in this discovery.");
    expect(excluded.text).not.toContain("private-hidden");
  });

  it("preserves predicate combinations, order, literal names, and physical special roots", async () => {
    const special = "./-directory space-日本語`";
    await fs.ensureDir(path.join(workspace, special));
    await fs.writeFile(path.join(workspace, special, 'quote"`file.ts'), "x");
    await fs.writeFile(path.join(workspace, special, "-help"), "x");
    const typeFile = await invoke(transport, [
      special,
      "-type",
      "f",
      "-name",
      "*.ts",
    ]);
    const reversed = await invoke(transport, [
      special,
      "-name",
      "*.ts",
      "-type",
      "f",
      "-print",
    ]);
    expect(typeFile.text).toContain("quote");
    expect(reversed.text).toContain("quote");
    expect(reversed.text).toContain("\\u0060");
    for (const literal of [
      "--help",
      "--allowance",
      "-exec",
      "$(echo unsafe)",
    ]) {
      await fs
        .writeFile(path.join(workspace, "literal-root", literal), "x")
        .catch(async () => {
          await fs.ensureDir(path.join(workspace, "literal-root"));
          await fs.writeFile(
            path.join(workspace, "literal-root", literal),
            "x",
          );
        });
      const result = await invoke(transport, [
        "literal-root",
        "-type",
        "f",
        "-name",
        literal,
      ]);
      expect(result.text).toContain(JSON.stringify(`literal-root/${literal}`));
    }
    const dirs = await invoke(transport, [special, "-type", "d"]);
    expect(dirs.text).toContain(
      JSON.stringify(special).replace(/`/g, "\\u0060"),
    );
  });

  it("rejects malformed grammar, allowances, and force tokens without enumeration or operand leaks", async () => {
    const protectedName = `private-${"x".repeat(180)}`;
    const cases = [
      [protectedName, "-name", "x", "late-root"],
      ["-name", "x", "-name", "y"],
      ["-type", "x"],
      ["-name", "x", "-print", "-print"],
      [".", "-exec", "cat", "{}", ";"],
      ["-name", "x", "--spekta-force"],
      ["--allowance"],
      ["--allowance", "1", "--allowance", "2", "."],
      [".", "--allowance", "2"],
      ["--allowance", "0", "."],
      ["--allowance", "1.5", "."],
      ["--allowance", "Infinity", "."],
      ["--allowance", "not-a-number", "."],
    ];
    for (const args of cases) {
      const before = (await readCalls()).length;
      const result = await invoke(transport, args);
      expect((await readCalls()).length).toBe(before);
      expect(result.failed).toBe(true);
      expect(result.text).not.toContain(protectedName);
      expect(result.text).not.toContain("late-root");
    }
    if (transport === "mcp") {
      for (const allowance of [
        0,
        -1,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        8001,
      ]) {
        const before = (await readCalls()).length;
        const result = await createToolRegistry({
          root: workspace,
        }).spekta_shell.handler(
          { command: "find", args: ["."], allowance },
          undefined,
          "allowance-check/9",
        );
        expect(result.isError).toBe(true);
        expect((await readCalls()).length).toBe(before);
      }
    }
  });

  it("uses configured list defaults and ceilings for per-request allowances", async () => {
    await fs.ensureDir(path.join(workspace, "configured"));
    await fs.writeFile(path.join(workspace, "configured", "value.ts"), "x");
    vi.stubEnv("SPEKTA_LIST_TOKEN_LIMIT", "500");
    vi.stubEnv("SPEKTA_LIST_TOKEN_CEILING", "600");
    const defaultResult =
      transport === "cli"
        ? await invoke(transport, ["configured", "-type", "f"])
        : await invoke(transport, ["configured", "-type", "f"]);
    const explicitResult =
      transport === "cli"
        ? await invoke(transport, [
            "--allowance",
            "500",
            "configured",
            "-type",
            "f",
          ])
        : await invoke(transport, ["configured", "-type", "f"], {
            allowance: 500,
          });
    expect(defaultResult.failed).toBe(false);
    expect(explicitResult.text).toBe(defaultResult.text);

    const before = (await readCalls()).length;
    const over =
      transport === "cli"
        ? await invoke(transport, ["--allowance", "601", "configured"])
        : await invoke(transport, ["configured"], { allowance: 601 });
    expect(over.failed).toBe(true);
    expect(over.text).toContain("configured ceiling is 600 tokens");
    expect((await readCalls()).length).toBe(before);
  });

  it("rejects below the measured minimum using the default budget before RTK probing", async () => {
    vi.stubEnv("SPEKTA_LIST_TOKEN_LIMIT", "500");
    vi.stubEnv("SPEKTA_LIST_TOKEN_CEILING", "600");
    const requestIds =
      transport === "mcp" ? [42, 'minimum/"request-17'] : [undefined];
    const roots = Array.from({ length: 100 }, () => ".");

    for (const requestId of requestIds) {
      const invokeAllowance = (allowance: number) =>
        transport === "cli"
          ? invoke("cli", ["--allowance", String(allowance), ...roots])
          : invoke("mcp", roots, { allowance, requestId });
      const rejected = await invokeAllowance(1);
      expect(rejected.failed).toBe(true);
      const minimumMatch = rejected.text.match(/at least (\d+) tokens/);
      expect(minimumMatch).not.toBeNull();
      const minimum = Number(minimumMatch![1]);
      expect(minimum).toBeGreaterThan(1);
      expect(rejected.text).toContain("configured ceiling is 600 tokens");
      expect(await readCalls()).toHaveLength(0);
      expect(await readProbeCount()).toBe(0);
      const defaultMeasured =
        transport === "cli"
          ? getTokenCount(rejected.rendered)
          : getTokenCount(rejected.serialized);
      expect(defaultMeasured).toBeLessThanOrEqual(500);

      const belowMinimum = await invokeAllowance(minimum - 1);
      expect(belowMinimum.failed).toBe(true);
      expect(belowMinimum.text).toContain(`at least ${minimum} tokens`);
      expect(await readCalls()).toHaveLength(0);
      expect(await readProbeCount()).toBe(0);

      const acceptedMinimum = await invokeAllowance(minimum);
      expect(acceptedMinimum.failed).toBe(true);
      expect(acceptedMinimum.text.toLowerCase()).toContain(
        "split the discovery roots",
      );
      expect(acceptedMinimum.text).not.toContain("Find needs at least");
      const requestedBudgetMeasured =
        transport === "cli"
          ? getTokenCount(acceptedMinimum.rendered)
          : getTokenCount(acceptedMinimum.serialized);
      expect(requestedBudgetMeasured).toBeLessThanOrEqual(minimum);
      expect(await readCalls()).toHaveLength(0);
      expect(await readProbeCount()).toBe(1);
      console.log("Minimum allowance boundary", {
        transport,
        requestId,
        configuredDefault: 500,
        configuredCeiling: 600,
        rejectedAllowance: 1,
        minimum,
        validationResponse: rejected.rendered,
        completeValidationTokens: defaultMeasured,
        belowMinimum: minimum - 1,
        acceptedMinimumStatus: acceptedMinimum.text,
        acceptedMinimumCompleteTokens: requestedBudgetMeasured,
        rtkProbesBeforeAccept: 0,
        rtkProbesAfterAccept: 1,
        enumerationsAtMinimum: (await readCalls()).length,
      });
      await fs.remove(probeMarker);
    }
  });

  it("reports a default budget that cannot contain the mandatory validation response", async () => {
    vi.stubEnv("SPEKTA_LIST_TOKEN_LIMIT", "1");
    vi.stubEnv("SPEKTA_LIST_TOKEN_CEILING", "1");
    const requestId = 'impossible/"default-1';
    const result =
      transport === "cli"
        ? await invoke("cli", ["--allowance", "1", "."])
        : await invoke("mcp", ["."], { allowance: 1, requestId });
    expect(result.failed).toBe(true);
    expect(result.text).toContain("SPEKTA_LIST_TOKEN_LIMIT");
    expect(result.text).toContain("SPEKTA_LIST_TOKEN_CEILING");
    if (transport === "mcp") {
      expect(result.text).toContain("shorten a long MCP request ID if needed");
    } else {
      expect(result.text).not.toContain("MCP request ID");
    }
    expect(result.text.length).toBeGreaterThan(0);
    const completeTokens =
      transport === "cli"
        ? getTokenCount(result.rendered)
        : getTokenCount(result.serialized);
    expect(completeTokens).toBeGreaterThan(1);
    expect(await readProbeCount()).toBe(0);
    expect(await readCalls()).toHaveLength(0);
    console.log("Unfittable configured default validation response", {
      transport,
      defaultAllowance: 1,
      requestedAllowance: 1,
      status: result.failed ? "usage_error" : "success",
      response: transport === "cli" ? result.rendered : result.serialized,
      completeTokens,
      rtkProbes: await readProbeCount(),
      enumerations: (await readCalls()).length,
      emitted: true,
    });
  });

  it("reports metadata overflow at the configured ceiling without an increase suggestion", async () => {
    const missingRoots = Array.from(
      { length: 1600 },
      (_, index) => `missing-${index}`,
    );
    const result =
      transport === "cli"
        ? await invoke(transport, ["--allowance", "8000", ...missingRoots])
        : await invoke(transport, missingRoots, { allowance: 8000 });
    expect(result.failed).toBe(true);
    expect(result.text).toContain("split discovery roots");
    expect(result.text).not.toContain("larger allowance");
    expect(await readCalls()).toHaveLength(0);
  }, 20000);

  it("fairly allocates unequal roots and redistributes after the short root completes", async () => {
    await fs.ensureDir(path.join(workspace, "short"));
    await fs.ensureDir(path.join(workspace, "long"));
    await fs.writeFile(path.join(workspace, "short", "s.ts"), "x");
    await fs.writeFile(path.join(workspace, "long", "a.ts"), "x");
    await fs.writeFile(path.join(workspace, "long", "b.ts"), "x");
    const deep =
      Array.from(
        { length: 14 },
        (_, index) => `z${index}-` + noisySegment(200),
      ).join("/") + "/tail.ts";
    await fs.ensureDir(path.dirname(path.join(workspace, "long", deep)));
    await fs.writeFile(path.join(workspace, "long", deep), "x");
    const allowance = transport === "cli" ? 1000 : 1050;
    const result =
      transport === "cli"
        ? await invoke(transport, [
            "--allowance",
            String(allowance),
            "short",
            "long",
            "-type",
            "f",
          ])
        : await invoke(transport, ["short", "long", "-type", "f"], {
            allowance,
          });
    expect(result.text).toContain('"short/s.ts"');
    expect(result.text).toContain('"long/a.ts"');
    expect(result.text).toContain('"long/b.ts"');
    expect(result.text).toContain("incomplete; output_limit_exceeded");
    expect(result.text).toContain("Narrow this root");
    expect(result.text).not.toContain(JSON.stringify(`long/${deep}`));
  });

  it("bounds metadata overflow and records whole incomplete paths with guidance", async () => {
    const many = Array.from({ length: 100 }, () => ".");
    const tiny =
      transport === "cli"
        ? await invoke(transport, ["--allowance", "100", ...many])
        : await invoke(transport, many, {
            allowance: 100,
            requestId: "overflow-id/11",
          });
    expect(tiny.failed).toBe(true);
    expect(tiny.text.toLowerCase()).toContain("split discovery roots");
    expect(await readCalls()).toHaveLength(0);
    const verySmall =
      transport === "cli"
        ? await invoke(transport, ["--allowance", "1", ...many])
        : await invoke(transport, many, { allowance: 1 });
    expect(verySmall.failed).toBe(true);
    expect(verySmall.text).toContain("Find needs at least");
    const verySmallComplete =
      transport === "cli"
        ? getTokenCount(verySmall.rendered)
        : getTokenCount(verySmall.serialized);
    expect(verySmallComplete).toBeLessThanOrEqual(1000);
    expect(await readCalls()).toHaveLength(0);
    await fs.ensureDir(path.join(workspace, "long"));
    const longName = Array.from(
      { length: 15 },
      () => `${noisySegment(160)}.ts`,
    ).join("/");
    await fs.ensureDir(path.dirname(path.join(workspace, "long", longName)));
    await fs.writeFile(path.join(workspace, "long", longName), "x");
    const allowance = 1000;
    const result =
      transport === "cli"
        ? await invoke(transport, [
            "--allowance",
            String(allowance),
            "long",
            "-type",
            "f",
          ])
        : await invoke(transport, ["long", "-type", "f"], { allowance });
    expect(result.text).toContain("incomplete; output_limit_exceeded");
    expect(result.text).toContain("Narrow this root");
    expect(result.text).not.toContain(JSON.stringify(`long/${longName}`));
  });

  it("retains good roots after child failure and treats missing RTK as request-wide", async () => {
    await fs.ensureDir(path.join(workspace, "good"));
    await fs.ensureDir(path.join(workspace, "fail"));
    await fs.writeFile(path.join(workspace, "good", "keep.ts"), "x");
    const failed = await invoke(transport, ["fail", "good", "-type", "f"]);
    expect(failed.failed).toBe(true);
    expect(failed.text).toContain("Operand 1: internal_failure");
    expect(failed.text).toContain('"good/keep.ts"');
    expect(failed.text).not.toContain("PRIVATE_STDERR_MARKER");
    const savedPath = process.env.PATH;
    vi.stubEnv("PATH", "");
    const callsBefore = (await readCalls()).length;
    const noRtk = await invoke(transport, ["good", "-type", "f"]);
    expect(noRtk.failed).toBe(true);
    expect(noRtk.text).toContain("engine_failure");
    expect((await readCalls()).length).toBe(callsBefore);
    vi.stubEnv("PATH", savedPath ?? "");
  });
});

it("handles a long escaped MCP request ID through the workspace-bound registry", async () => {
  vi.stubEnv("SPEKTA_LIST_TOKEN_LIMIT", "500");
  vi.stubEnv("SPEKTA_LIST_TOKEN_CEILING", "8000");
  const requestId = `long/"mcp-${"x".repeat(5000)}`;
  const result = await invoke("mcp", ["."], {
    allowance: 1,
    requestId,
  });
  const envelope = JSON.parse(result.serialized.trimEnd()) as {
    id: string | number;
    result: { isError: boolean; content: Array<{ text: string }> };
  };
  const completeTokens = getTokenCount(result.serialized);

  expect(result.failed).toBe(true);
  expect(envelope.id).toBe(requestId);
  expect(envelope.result.isError).toBe(true);
  expect(envelope.result.content[0].text).toBe(result.text);
  expect(result.text).toContain("shorten a long MCP request ID if needed");
  expect(result.text).toContain("SPEKTA_LIST_TOKEN_LIMIT");
  expect(result.text).not.toContain(requestId);
  expect(result.text).not.toContain("x".repeat(100));
  expect(completeTokens).toBeGreaterThan(500);
  expect(await readProbeCount()).toBe(0);
  expect(await readCalls()).toHaveLength(0);
  console.log("Long MCP request ID mandatory validation exception", {
    requestIdLength: requestId.length,
    defaultAllowance: 500,
    requestedAllowance: 1,
    status: "usage_error",
    responseBody: result.text,
    responseIdRoundTrips: envelope.id === requestId,
    completeResponseTokens: completeTokens,
    rtkProbes: await readProbeCount(),
    enumerations: (await readCalls()).length,
  });
});

it("checks complete CLI and MCP response costs at transport-specific boundaries", async () => {
  await fs.ensureDir(path.join(workspace, "budget"));
  const boundaryPath = path.join(
    workspace,
    "budget",
    ...Array.from(
      { length: 15 },
      (_, index) => `retained-long-entry-${index}-` + noisySegment(140) + ".ts",
    ),
  );
  await fs.ensureDir(path.dirname(boundaryPath));
  await fs.writeFile(boundaryPath, "x");
  const cliRoomy = await invoke("cli", [
    "--allowance",
    "8000",
    "budget",
    "-type",
    "f",
  ]);
  const mcpRoomy = await invoke("mcp", ["budget", "-type", "f"], {
    requestId: "boundary-id/34",
    allowance: 8000,
  });
  const cliCost = getTokenCount(cliRoomy.rendered);
  const mcpCost = getTokenCount(mcpRoomy.serialized);
  const cliExact = await invoke("cli", [
    "--allowance",
    String(cliCost),
    "budget",
    "-type",
    "f",
  ]);
  const cliUnder = await invoke("cli", [
    "--allowance",
    String(cliCost - 1),
    "budget",
    "-type",
    "f",
  ]);
  const mcpExact = await createToolRegistry({
    root: workspace,
  }).spekta_shell.handler(
    { command: "find", args: ["budget", "-type", "f"], allowance: mcpCost },
    undefined,
    "boundary-id/34",
  );
  const mcpUnder = await createToolRegistry({
    root: workspace,
  }).spekta_shell.handler(
    { command: "find", args: ["budget", "-type", "f"], allowance: mcpCost - 1 },
    undefined,
    "boundary-id/34",
  );
  expect(getTokenCount(cliExact.rendered)).toBe(cliCost);
  expect(cliUnder.text).not.toContain("retained-long-entry");
  expect(mcpExact.content[0].text).toContain("retained-long-entry");
  expect(mcpUnder.content[0].text).not.toContain("retained-long-entry");
  expect(
    getTokenCount(
      mcpEnvelope(
        "boundary-id/34",
        mcpExact.content[0].text,
        mcpExact.isError === true,
      ),
    ),
  ).toBeLessThanOrEqual(mcpCost);
});

it("returns matching ordinary success bodies and statuses from both public adapters", async () => {
  await fs.ensureDir(path.join(workspace, "shared"));
  await fs.writeFile(path.join(workspace, "shared", "shared.ts"), "x");
  const cli = await invoke("cli", ["shared", "-type", "f"]);
  const mcp = await invoke("mcp", ["shared", "-type", "f"]);
  expectParity(cli, mcp);
  expect(cli.text).toContain('"shared/shared.ts"');
  console.log("Ordinary public discovery responses", {
    configuredDefaultAllowance: 1000,
    cliStatus: cli.failed ? "failed" : "success",
    cliBody: cli.text,
    cliCompleteResponseTokens: getTokenCount(cli.rendered),
    mcpStatus: mcp.failed ? "failed" : "success",
    mcpBody: mcp.text,
    mcpCompleteResponseTokens: getTokenCount(mcp.serialized),
    mcpEnvelope: mcp.serialized,
  });
});

it("returns matching mixed unavailable bodies and partial statuses from both public adapters", async () => {
  await fs.ensureDir(path.join(workspace, "good"));
  await fs.writeFile(path.join(workspace, "good", "kept.ts"), "x");
  const args = ["missing-secret-root", "good", "-type", "f"];
  const cli = await invoke("cli", args);
  const mcp = await invoke("mcp", args);
  expectParity(cli, mcp);
  expect(cli.failed).toBe(true);
  expect(cli.text).toContain("Operand 1: unavailable; unavailable_access");
  expect(cli.text).toContain('"good/kept.ts"');
  expect(cli.text).not.toContain("missing-secret-root");
});
