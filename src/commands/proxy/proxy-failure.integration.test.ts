import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { build } from "vite";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { TOOL_REGISTRY } from "../../api/mcp-server/registry";
import { getTokenCount } from "../../utils/read-utils";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const secret = "ghp_abcdefghijklmnopqrstuvwxyz";
let root: string;
let fixture: string;
let bin: string;
let workspace: string;
let cliEntry: string;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "spekta-proxy-status-"));
  fs.writeJsonSync(path.join(root, "package.json"), { type: "module" });
  // The SSR build keeps runtime dependencies external to the temporary dist.
  fs.symlinkSync(
    path.join(repository, "node_modules"),
    path.join(root, "node_modules"),
    "dir",
  );
  const outDir = path.join(root, "dist");
  await build({
    configFile: path.join(repository, "vite.config.ts"),
    root: repository,
    logLevel: "error",
    build: { outDir, emptyOutDir: true },
  });
  cliEntry = path.join(outDir, "index.js");
}, 60000);

beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(root, "case-"));
  bin = path.join(fixture, "bin");
  workspace = path.join(fixture, "workspace");
  fs.ensureDirSync(bin);
  fs.ensureDirSync(workspace);
  fs.writeJsonSync(path.join(bin, "package.json"), { type: "commonjs" });
  fs.writeFileSync(
    path.join(bin, "ls"),
    `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(path.join(fixture, "underlying.marker"))}, "started");\n`,
    { mode: 0o755 },
  );
  vi.stubEnv("PATH", bin);
  vi.spyOn(process, "cwd").mockReturnValue(workspace);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

afterAll(() => {
  if (root) fs.removeSync(root);
});

function installRtk(mode: string): void {
  if (mode === "missing") return;
  const names = [
    "USEFUL_START.txt",
    ...Array.from(
      { length: 250 },
      (_, index) => `entry-${String(index).padStart(4, "0")}.txt`,
    ),
    `${secret}.txt`,
    "USEFUL_END.txt",
  ];
  for (const name of names) fs.writeFileSync(path.join(workspace, name), "x");
  const output = `${names.join("\n")}\n`;
  const source = `#!${process.execPath}
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(path.join(fixture, "rtk.marker"))}, "started");
fs.writeSync(1, ${JSON.stringify(output)});
fs.writeSync(2, "USEFUL_STDERR\\n");
${mode === "signal" ? 'process.kill(process.pid, "SIGTERM");' : `process.exit(${mode === "failure" ? 7 : 0});`}
`;
  fs.writeFileSync(path.join(bin, "rtk"), source, {
    mode: mode === "permission" ? 0o644 : 0o755,
  });
}

async function both(args: string[] = []) {
  const stdoutFile = path.join(fixture, "stdout.txt");
  const stderrFile = path.join(fixture, "stderr.txt");
  // Capture through file descriptors so Node writes synchronously, including
  // when reporting a failure immediately before process.exit().
  const stdout = fs.openSync(stdoutFile, "w");
  const stderr = fs.openSync(stderrFile, "w");
  let result;
  try {
    result = await execa(process.execPath, [cliEntry, "ls", ...args], {
      cwd: workspace,
      env: {
        ...process.env,
        PATH: bin,
        SPEKTA_HOME_OVERRIDE: path.join(fixture, "home"),
        SPEKTA_ASSET_ROOT_OVERRIDE: repository,
      },
      stdout,
      stderr,
      reject: false,
    });
  } finally {
    fs.closeSync(stdout);
    fs.closeSync(stderr);
  }
  const cli = {
    ...result,
    stdout: fs.readFileSync(stdoutFile, "utf8").trimEnd(),
    stderr: fs.readFileSync(stderrFile, "utf8").trimEnd(),
  };
  const mcp = await TOOL_REGISTRY.spekta_shell.handler({ command: "ls", args });
  expect(fs.existsSync(path.join(fixture, "underlying.marker"))).toBe(false);
  return { cli, mcp };
}

describe.sequential("real subprocess proxy failure reporting", () => {
  it("preserves success status and safe condensed eligible output", async () => {
    installRtk("success");
    const { cli, mcp } = await both();
    expect(cli.exitCode).toBe(0);
    expect(mcp.isError).toBe(false);
    for (const output of [cli.stdout, mcp.content[0].text]) {
      expect(output).toContain("USEFUL_START");
      expect(output).toContain("USEFUL_END");
      expect(output).toMatch(/lines collapsed/);
      expect(output).not.toContain(secret);
      expect(output).not.toContain("USEFUL_STDERR");
    }
    expect(getTokenCount(mcp.content[0].text)).toBeLessThanOrEqual(1000);
    expect(getTokenCount(`${cli.stdout}\n`)).toBeLessThanOrEqual(1000);
    expect(cli.stderr).toBe("");
  }, 30000);

  it("reports a failing child by status only", async () => {
    installRtk("failure");
    const { cli, mcp } = await both();
    expect(cli.exitCode).toBe(7);
    expect(cli.stdout).toBe("");
    expect(cli.stderr).toMatch(/status 7/);
    expect(mcp.isError).toBe(true);
    for (const output of [cli.stderr, mcp.content[0].text]) {
      expect(output).toMatch(/status 7/);
      expect(output).not.toContain("USEFUL");
      expect(output).not.toContain(secret);
    }
  });

  it.each(["missing", "permission", "signal"])(
    "reports %s as failure without fallback",
    async (mode) => {
      installRtk(mode);
      const { cli, mcp } = await both();
      expect(cli.exitCode).toBe(1);
      expect(cli.stdout).toBe("");
      expect(cli.stderr).not.toBe("");
      expect(mcp.isError).toBe(true);
      expect(mcp.content[0].text).not.toBe("");
      for (const output of [cli.stderr, mcp.content[0].text]) {
        expect(output).not.toContain(secret);
        expect(getTokenCount(output)).toBeLessThanOrEqual(1000);
        if (mode === "missing") {
          expect(output).toMatch(/rtk/i);
          expect(output).toMatch(/not found|missing/i);
        }
        if (mode === "signal") {
          expect(output).toContain("RTK listing failed");
          expect(output).not.toContain("USEFUL_STDERR");
        }
      }
    },
  );

  it("rejects unsupported arguments before either executable starts", async () => {
    installRtk("success");
    const { cli, mcp } = await both(["--spekta-force"]);
    expect(cli.exitCode).toBe(1);
    expect(cli.stdout).toBe("");
    expect(cli.stderr).not.toBe("");
    expect(mcp.isError).toBe(true);
    expect(fs.existsSync(path.join(fixture, "rtk.marker"))).toBe(false);
  });
});
