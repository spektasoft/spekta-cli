import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchCommand } from "../../cli/commands";
import { createToolRegistry } from "../../api/mcp-server/registry";
import { getTokenCount } from "../../utils/read-utils";

let root: string;
let bin: string;
let workspace: string;
let marker: string;
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
  root = await fs.mkdtemp(path.join(os.tmpdir(), "spekta-ls-public-"));
  workspace = path.join(root, "workspace");
  bin = path.join(root, "bin");
  marker = path.join(root, "rtk-invocations.txt");
  await fs.ensureDir(workspace);
  await fs.ensureDir(bin);
  await installFakeRtk();
  process.chdir(workspace);
  vi.stubEnv("PATH", bin);
  vi.stubEnv("SPEKTA_HOME_OVERRIDE", path.join(root, "home"));
  vi.stubEnv("SPEKTA_ASSET_ROOT_OVERRIDE", repository);
  vi.stubEnv("SPEKTA_LIST_TOKEN_LIMIT", "1000");
  vi.stubEnv("SPEKTA_LIST_TOKEN_CEILING", "8000");
});

afterEach(async () => {
  process.chdir(savedCwd);
  process.exitCode = savedExitCode;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fs.remove(root);
});

async function installFakeRtk(): Promise<void> {
  await fs.writeJson(path.join(bin, "package.json"), { type: "commonjs" });
  const source = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] === "--version") { process.stdout.write("rtk 0.50.0\\n"); process.exit(0); }
const operand = args.at(-1) || ".";
fs.appendFileSync(${JSON.stringify(marker)}, operand + "\\n");
if (operand === "fail") { fs.writeSync(2, "PRIVATE_STDERR"); process.exit(7); }
const dir = path.resolve(process.cwd(), operand);
const names = fs.readdirSync(dir).sort();
if (args[1] === "find") fs.writeSync(1, names.map((name) => "./" + name).join("\\n") + "\\n");
else if (names.length) fs.writeSync(1, names.join("\\n") + "\\n");
`;
  await fs.writeFile(path.join(bin, "rtk"), source, { mode: 0o755 });
}

function bodyFromCli(text: string): string {
  const match = text.match(/```\n([\s\S]*?)\n```/);
  expect(match).not.toBeNull();
  return match![1];
}

async function invoke(
  transport: "cli" | "mcp",
  operands: string[],
  allowance?: number,
  command = "ls",
) {
  process.exitCode = undefined;
  if (transport === "cli") {
    let output = "";
    let errorOutput = "";
    const spy = vi.spyOn(console, "log").mockImplementation((...items) => {
      output += `${items.join(" ")}\n`;
    });
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation((...items) => {
        errorOutput += `${items.join(" ")}\n`;
      });
    try {
      const args = [...operands];
      if (allowance !== undefined) args.push("--allowance", String(allowance));
      await dispatchCommand(command, args);
      return {
        text: output ? bodyFromCli(output) : errorOutput.trimEnd(),
        rendered: output || errorOutput,
        failed: process.exitCode === 1,
        raw: output || errorOutput,
      };
    } finally {
      spy.mockRestore();
      errorSpy.mockRestore();
    }
  }
  const args: Record<string, unknown> = { command, args: operands };
  if (allowance !== undefined) args.allowance = allowance;
  const result = await createToolRegistry({
    root: workspace,
  }).spekta_shell.handler(args);
  return {
    text: result.content[0].text,
    rendered: result.content[0].text,
    failed: result.isError === true,
    raw: result.content[0].text,
  };
}

describe.each(["cli", "mcp"] as const)("public ls over %s", (transport) => {
  it("uses the default root and treats explicit dot and spaced paths literally", async () => {
    await fs.writeFile(path.join(workspace, "root-entry"), "x");
    await fs.ensureDir(path.join(workspace, ".hidden dir"));
    await fs.writeFile(path.join(workspace, ".hidden dir", "spaced file"), "x");
    const rootResult = await invoke(transport, []);
    const explicit = await invoke(transport, [".hidden dir"]);
    expect(rootResult.text).toContain('Operand 1: returned; "."');
    expect(rootResult.text).toContain('"root-entry"');
    expect(explicit.text).toContain('Operand 1: returned; ".hidden dir"');
    expect(explicit.text).toContain('"spaced file"');
    expect(explicit.failed).toBe(false);
  });

  it("keeps several valid directories in supplied order with independent entries", async () => {
    for (const name of ["first dir", ".second"]) {
      await fs.ensureDir(path.join(workspace, name));
      await fs.writeFile(path.join(workspace, name, `${name}-entry`), "x");
    }
    const result = await invoke(transport, ["first dir", ".second"]);
    expect(
      result.text.indexOf('Operand 1: returned; "first dir"'),
    ).toBeLessThan(result.text.indexOf('Operand 2: returned; ".second"'));
    expect(result.text).toContain('"first dir-entry"');
    expect(result.text).toContain('".second-entry"');
  });

  it("conceals a missing operand while retaining a valid sibling", async () => {
    await fs.ensureDir(path.join(workspace, "good"));
    await fs.writeFile(path.join(workspace, "good", "retained"), "x");
    const result = await invoke(transport, ["secret-missing-name", "good"]);
    expect(result.text).toContain("Operand 1: unavailable; unavailable_access");
    expect(result.text).toContain('Operand 2: returned; "good"');
    expect(result.text).toContain('"retained"');
    expect(result.text).not.toContain("secret-missing-name");
    expect(result.failed).toBe(true);
  });

  it("makes restricted, ignored, outside and symlink paths indistinguishable from missing", async () => {
    const outside = path.join(root, "outside");
    await fs.ensureDir(path.join(workspace, ".env"));
    await fs.ensureDir(path.join(workspace, "ignored"));
    await fs.writeFile(path.join(workspace, ".spektaignore"), "ignored\n");
    await fs.ensureDir(outside);
    await fs.symlink(outside, path.join(workspace, "escape"));
    const denied = [".env", "ignored", outside, "escape", "missing-private"];
    const outputs = [];
    for (const item of denied) outputs.push(await invoke(transport, [item]));
    for (const [index, result] of outputs.entries()) {
      expect(result.text).toContain(
        "Operand 1: unavailable; unavailable_access",
      );
      expect(result.text).not.toContain(denied[index]);
    }
    expect(new Set(outputs.map((result) => result.text)).size).toBe(1);
  });

  it("uses identical empty-list wording for empty and excluded-only directories", async () => {
    await fs.ensureDir(path.join(workspace, "empty"));
    await fs.ensureDir(path.join(workspace, "excluded"));
    await fs.writeFile(path.join(workspace, "excluded", "private-hidden"), "x");
    await fs.writeFile(
      path.join(workspace, ".spektaignore"),
      "private-hidden\n",
    );
    const empty = await invoke(transport, ["empty"]);
    const excluded = await invoke(transport, ["excluded"]);
    expect(empty.text).toContain("No eligible entries in this listing.");
    expect(excluded.text).toContain("No eligible entries in this listing.");
    expect(excluded.text).not.toContain("private-hidden");
    expect(empty.text.replace('"empty"', '"excluded"')).toBe(excluded.text);
  });

  it("keeps entries whole and reports long results as incomplete", async () => {
    const directory = "operand-" + "d".repeat(110);
    await fs.ensureDir(path.join(workspace, directory));
    const longNames = Array.from(
      { length: 70 },
      (_, index) =>
        `entry-${String(index).padStart(2, "0")}-${randomBytes(90).toString("hex")}.txt`,
    );
    for (const name of longNames)
      await fs.writeFile(path.join(workspace, directory, name), "x");
    const result = await invoke(transport, [directory], 800);
    expect(result.text).toContain(
      "Operand 1: incomplete; output_limit_exceeded",
    );
    expect(result.text).toContain(
      "Listing incomplete. List a narrower directory",
    );
    for (const line of result.text
      .split("\n")
      .filter((value) => value.startsWith('"entry-'))) {
      expect(longNames.map((name) => JSON.stringify(name))).toContain(line);
    }
    expect(
      longNames.some((name) => result.text.includes(JSON.stringify(name))),
    ).toBe(true);
    expect(
      longNames.some((name) => !result.text.includes(JSON.stringify(name))),
    ).toBe(true);
  });

  it("keeps duplicate operands and duplicate entry names in order", async () => {
    await fs.ensureDir(path.join(workspace, "repeat"));
    await fs.writeFile(path.join(workspace, "repeat", "same-name"), "x");
    const result = await invoke(transport, ["repeat", "repeat"]);
    expect(result.text.match(/Operand 1: returned/g)).toHaveLength(1);
    expect(result.text.match(/Operand 2: returned/g)).toHaveLength(1);
    expect(result.text.match(/"same-name"/g)).toHaveLength(2);
  });

  it("fits an exact allowance and becomes incomplete one token below it", async () => {
    await fs.ensureDir(path.join(workspace, "budget"));
    for (let index = 0; index < 40; index++)
      await fs.writeFile(
        path.join(
          workspace,
          "budget",
          `entry-${String(index).padStart(3, "0")}-${randomBytes(50).toString("hex")}`,
        ),
        "x",
      );
    let low = 1;
    let high = 7000;
    while (low < high) {
      const midpoint = Math.floor((low + high) / 2);
      const candidate = await invoke(transport, ["budget"], midpoint);
      if (candidate.text.includes("Batch: success")) high = midpoint;
      else low = midpoint + 1;
    }
    const exactAllowance = low;
    const exact = await invoke(transport, ["budget"], exactAllowance);
    const short = await invoke(transport, ["budget"], exactAllowance - 1);
    expect(exact.text).toContain("Operand 1: returned;");
    expect(exact.failed).toBe(false);
    expect(getTokenCount(exact.rendered)).toBeLessThanOrEqual(exactAllowance);
    expect(short.text).toContain(
      "Operand 1: incomplete; output_limit_exceeded",
    );
    expect(short.text).toContain("Listing incomplete.");
  }, 30000);

  it("shares capacity fairly, redistributes after a short listing, and retains siblings on RTK failure", async () => {
    for (const name of ["huge", "brief", "later"])
      await fs.ensureDir(path.join(workspace, name));
    for (let index = 0; index < 300; index++)
      await fs.writeFile(path.join(workspace, "huge", `huge-${index}`), "x");
    await fs.writeFile(path.join(workspace, "brief", "one"), "x");
    for (let index = 0; index < 100; index++)
      await fs.writeFile(path.join(workspace, "later", `later-${index}`), "x");
    const result = await invoke(transport, ["huge", "brief", "later"], 1200);
    expect(result.text).toContain('Operand 2: returned; "brief"');
    expect(result.text).toContain('"one"');
    expect(result.text).toContain('"later-');
    expect(result.text).toContain("Operand 1: incomplete");
    expect(result.text).toContain('Operand 3: returned; "later"');

    await fs.ensureDir(path.join(workspace, "good"));
    await fs.ensureDir(path.join(workspace, "fail"));
    await fs.writeFile(path.join(workspace, "good", "kept"), "x");
    const failed = await invoke(transport, ["fail", "good"]);
    expect(failed.text).toContain(
      "Operand 1: internal_failure; listing failed",
    );
    expect(failed.text).toContain('Operand 2: returned; "good"');
    expect(failed.text).toContain('"kept"');
    expect(failed.text).not.toContain("PRIVATE_STDERR");
  }, 20000);
});

it.each(["cli", "mcp"] as const)(
  "rejects metadata overflow before RTK through %s and omits increase guidance at the ceiling",
  async (transport) => {
    const many = Array.from({ length: 100 }, () => ".");
    const overflow = await invoke(transport, many, 100);
    expect(fs.existsSync(marker)).toBe(false);
    expect(overflow.text).toContain("Split the batch into fewer directories.");
    expect(overflow.text).toContain("larger allowance");
    const atCeiling = await invoke(transport, many, 8000);
    expect(atCeiling.text).toContain("Split the batch into fewer directories.");
    expect(atCeiling.text).not.toContain("larger allowance");
    expect(fs.existsSync(marker)).toBe(false);

    const capture = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      await dispatchCommand("ls", ["--allowance"]);
      await dispatchCommand("ls", ["--allowance", "1", "--allowance", "2"]);
      expect(capture).toHaveBeenCalledTimes(2);
      for (const [message] of capture.mock.calls)
        expect(String(message)).toBe(
          "usage_error: ls accepts one --allowance value. Use spekta help ls.",
        );
    } finally {
      capture.mockRestore();
    }
  },
);

it.each(["cli", "mcp"] as const)(
  "rejects an over-ceiling allowance through %s",
  async (transport) => {
    const over = await invoke(transport, ["."], 8001);
    expect(over.text).toContain(
      "output_limit_exceeded: Requested allowance 8001",
    );
    expect(over.text).toContain("configured ceiling of 8000 tokens");
  },
);

it("accepts MCP allowance for find while retaining the ls and find shared budget contract", async () => {
  await fs.writeFile(path.join(workspace, "find-allowance-entry.ts"), "x");
  const nonLs = await invoke("mcp", [], 1000, "find");
  expect(nonLs.failed).toBe(false);
  expect(nonLs.text).toContain("Batch: success");
  expect(nonLs.text).toContain('"find-allowance-entry.ts"');
  expect(fs.existsSync(marker)).toBe(true);
});

it.each(["cli", "mcp"] as const)(
  "reports missing RTK over %s with the sanitized whole-request message",
  async (transport) => {
    await fs.remove(path.join(bin, "rtk"));
    vi.stubEnv("PATH", "");
    const result = await invoke(transport, ["."]);
    expect(result.failed).toBe(true);
    expect(result.text).toBe(
      "RTK listing failed before output could be checked.",
    );
  },
);

it.each(["cli", "mcp"] as const)(
  "renders multi-root batch find behavior over %s",
  async (transport) => {
    await fs.writeFile(path.join(workspace, "find-regression.txt"), "x");
    const result = await invoke(transport, [], undefined, "find");
    expect(result.text).toContain("Batch: success");
    expect(result.text).toContain('Operand 1: returned; "."');
    expect(result.text).toContain('"find-regression.txt"');
    expect(result.failed).toBe(false);
  },
);
