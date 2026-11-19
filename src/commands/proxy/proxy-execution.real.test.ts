import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeRtkCommand } from "./proxy-execution";

let fixture: string | undefined;

afterEach(() => {
  vi.unstubAllEnvs();
  if (fixture !== undefined) fs.removeSync(fixture);
  fixture = undefined;
});

describe("executeRtkCommand with real Execa child processes", () => {
  it("preserves argument tokens, cwd, env, and captured output", async () => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), "spekta-proxy-execa-"));
    const bin = path.join(fixture, "bin");
    const workspace = path.join(fixture, "workspace");
    fs.ensureDirSync(bin);
    fs.ensureDirSync(workspace);

    const childSource = `const fs = require("node:fs");
fs.writeSync(1, JSON.stringify({args: process.platform === "win32" ? ["probe", ...process.argv.slice(2)] : process.argv.slice(2), cwd: process.cwd(), env: {marker: process.env.PROXY_EXECA_TEST, noColor: process.env.NO_COLOR, term: process.env.TERM}}));
fs.writeSync(2, "captured stderr");
fs.writeFileSync(process.env.PROXY_EXECA_MARKER, "ran");
`;
    if (process.platform === "win32") {
      // A copied Node executable gives Windows a native .exe fixture without
      // routing arguments through cmd.exe or a shell script.
      fs.copyFileSync(process.execPath, path.join(bin, "rtk.exe"));
      fs.writeFileSync(path.join(workspace, "probe"), childSource);
    } else {
      fs.writeFileSync(
        path.join(bin, "rtk"),
        `#!${process.execPath}\n${childSource}`,
        { mode: 0o755 },
      );
    }

    vi.stubEnv("PATH", bin);
    vi.stubEnv("PROXY_EXECA_TEST", "copied environment");
    vi.stubEnv("PROXY_EXECA_MARKER", path.join(fixture, "child-ran"));
    const args = ["space value", "punctuation; $'\"", "雪 café 🦄"];
    const expected = {
      args: ["probe", ...args],
      cwd: workspace,
      env: {
        marker: "copied environment",
        noColor: "1",
        term: "dumb",
      },
    };

    const result = await executeRtkCommand("probe", args, { root: workspace });
    expect(fs.existsSync(path.join(fixture, "child-ran"))).toBe(true);
    expect(result).toEqual({
      available: true,
      stdout: JSON.stringify(expected),
      stderr: "captured stderr",
      exitCode: 0,
    });
  });
});
