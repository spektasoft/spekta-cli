import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { confirm } from "@inquirer/prompts";
import { runRtkProxy } from "./proxy";
import { TOOL_REGISTRY } from "../api/mcp-server/registry";
import { getTokenCount } from "../utils/read-utils";

vi.mock("execa", () => ({ execa: vi.fn() }));
vi.mock("@inquirer/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@inquirer/prompts")>()),
  confirm: vi.fn(),
}));

let fixture: string;
let workspace: string;
let savedExitCode: typeof process.exitCode;
let savedTtyDescriptor: PropertyDescriptor | undefined;
const secret = "ghp_abcdefghijklmnopqrstuvwxyz";

beforeEach(() => {
  vi.resetAllMocks();
  savedExitCode = process.exitCode;
  savedTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  process.exitCode = undefined;
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "spekta-proxy-integration-"));
  workspace = path.join(fixture, "workspace");
  fs.ensureDirSync(path.join(workspace, "directory"));
  fs.ensureDirSync(path.join(fixture, "outside"));
  fs.ensureDirSync(path.join(workspace, ".env"));
  fs.ensureDirSync(path.join(workspace, ".gitignore"));
  fs.ensureDirSync(path.join(workspace, ".spektaignore"));
  fs.writeFileSync(path.join(workspace, "file.txt"), "file");
  fs.symlinkSync(
    path.join(fixture, "outside"),
    path.join(workspace, "escape"),
    "dir",
  );
  fs.symlinkSync(
    path.join(workspace, ".env"),
    path.join(workspace, "restricted-alias"),
    "dir",
  );
  vi.spyOn(process, "cwd").mockReturnValue(workspace);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(execa).mockResolvedValue({
    stdout: "listing",
    stderr: "",
    exitCode: 0,
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = savedExitCode;
  if (savedTtyDescriptor) {
    Object.defineProperty(process.stdin, "isTTY", savedTtyDescriptor);
  } else {
    Reflect.deleteProperty(process.stdin, "isTTY");
  }
  fs.removeSync(fixture);
});

async function expectRejected(command: string, args: string[], reason: RegExp) {
  await runRtkProxy(command, args);
  const cli: unknown = vi.mocked(console.error).mock.calls.at(-1)?.[0];
  if (typeof cli !== "string") {
    throw new Error("Expected a string CLI rejection diagnostic.");
  }
  const mcp = await TOOL_REGISTRY.spekta_shell.handler({ command, args });
  expect(cli).toMatch(reason);
  expect(cli).not.toContain(secret);
  expect(process.exitCode).toBe(1);
  expect(console.log).not.toHaveBeenCalled();
  expect(mcp).toEqual({
    isError: true,
    content: [{ type: "text", text: cli }],
  });
  expect(execa).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
}

describe("CLI and MCP proxy parity", () => {
  it.each([
    { args: [] },
    { args: ["."] },
    { args: ["directory"] },
    { args: ["./directory"] },
  ])(
    "executes accepted args $args through the same RTK invocation",
    async ({ args }) => {
      await runRtkProxy("ls", args);
      const mcp = await TOOL_REGISTRY.spekta_shell.handler({
        command: "ls",
        args,
      });
      expect(execa).toHaveBeenCalledTimes(2);
      expect(execa).toHaveBeenNthCalledWith(
        1,
        "rtk",
        ["ls", ...args],
        expect.any(Object),
      );
      expect(execa).toHaveBeenNthCalledWith(
        2,
        "rtk",
        ["ls", ...args],
        expect.any(Object),
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("### spekta ls"),
      );
      expect(console.error).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
      expect(mcp).toEqual({
        isError: false,
        content: [{ type: "text", text: "listing" }],
      });
      expect(confirm).not.toHaveBeenCalled();
    },
  );

  it("treats omitted MCP args as ls without an operand", async () => {
    const result = await TOOL_REGISTRY.spekta_shell.handler({ command: "ls" });
    expect(result.isError).toBe(false);
    expect(execa).toHaveBeenCalledWith("rtk", ["ls"], expect.any(Object));
  });

  it.each([true, false])(
    "rejects the full matrix without prompting with isTTY=%s",
    async (isTTY) => {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: isTTY,
      });
      const requests: Array<[string, string[], RegExp]> = [
        ["unknown-command", [], /unsupported command/i],
        [secret, [], /unsupported command/i],
        ["/bin/ls", [], /unsupported command/i],
        ["ls; touch marker", [], /unsupported command/i],
        ["git", ["status"], /unsupported command/i],
        ["vitest", [], /unsupported command/i],
        ["jest", [], /unsupported command/i],
        ["pytest", [], /unsupported command/i],
        ["tsc", [], /unsupported command/i],
        ["cargo", ["build"], /unsupported command/i],
        ["npm", ["run", "build"], /unsupported command/i],
        ["pnpm", ["test"], /unsupported command/i],
        ["yarn", ["lint"], /unsupported command/i],
        ["bun", ["run", "script"], /unsupported command/i],
        ["node", ["script.js"], /unsupported command/i],
        ["sh", ["-c", "touch marker"], /unsupported command/i],
        ["ls", ["-a"], /unsupported option/i],
        ["ls", ["--"], /unsupported option/i],
        ["ls", ["--color=always"], /unsupported option/i],
        ["ls", ["--spekta-force"], /unsupported option.*--spekta-force/i],
        [
          "ls",
          ["directory", "--spekta-force"],
          /unsupported option.*--spekta-force/i,
        ],
        [
          "ls",
          ["--spekta-force", "directory"],
          /unsupported option.*--spekta-force/i,
        ],
        ["ls", ["--spekta-force=true"], /unsupported option.*--spekta-force/i],
        [
          "npm",
          ["run", "build", "--spekta-force"],
          /unsupported option.*--spekta-force/i,
        ],
        ["ls", [".", "directory"], /at most one/i],
        ["ls", [""], /invalid directory operand/i],
        ["ls", ["file.txt"], /existing workspace directory/i],
        ["ls", ["missing"], /existing workspace directory/i],
        ["ls", [".env"], /restricted/i],
        ["ls", [".gitignore"], /restricted/i],
        ["ls", [".spektaignore"], /restricted/i],
        ["ls", [".env/child"], /restricted/i],
        ["ls", ["restricted-alias"], /restricted/i],
        ["ls", ["../outside"], /outside the project directory/i],
        ["ls", [workspace], /outside the project directory/i],
        ["ls", ["C:/outside"], /outside the project directory/i],
        ["ls", [String.raw`C:\outside`], /outside the project directory/i],
        [
          "ls",
          [String.raw`\\server\share\outside`],
          /outside the project directory/i,
        ],
        ["ls", ["escape"], /outside the project directory/i],
        ["ls", ["escape/missing/child"], /outside the project directory/i],
        ["ls", [`../${secret}`], /outside the project directory/i],
      ];
      for (const [command, args, reason] of requests)
        await expectRejected(command, args, reason);
    },
  );

  it("redacts and bounds filesystem error diagnostics in both entry points", async () => {
    vi.spyOn(fs, "realpathSync").mockImplementation(() => {
      throw new Error(`${secret} ${"failure ".repeat(3000)}`);
    });
    await expectRejected("ls", ["directory"], /\[REDACTED\]/);
    const diagnostic = vi.mocked(console.error).mock.calls[0][0] as string;
    expect(getTokenCount(diagnostic)).toBeLessThanOrEqual(1000);
  });

  it("preserves redaction and condensation for accepted output", async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: `${secret}\n${"listing line\n".repeat(3000)}`,
      stderr: "",
      exitCode: 0,
    } as never);
    await runRtkProxy("ls", []);
    const mcp = await TOOL_REGISTRY.spekta_shell.handler({ command: "ls" });
    const cli = vi.mocked(console.log).mock.calls[0][0] as string;
    expect(cli).toContain("OUTPUT TRUNCATED");
    expect(cli).not.toContain(secret);
    expect(mcp.content[0].text).not.toContain(secret);
    expect(mcp.content[0].text).toContain("lines collapsed");
    expect(getTokenCount(mcp.content[0].text)).toBeLessThanOrEqual(1000);
  });

  it("preserves MCP nonzero RTK result and missing RTK error responses", async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      stdout: "",
      stderr: secret,
      exitCode: 2,
    } as never);
    const failed = await TOOL_REGISTRY.spekta_shell.handler({ command: "ls" });
    expect(failed).toEqual({
      isError: true,
      content: [{ type: "text", text: "[REDACTED]" }],
    });
    vi.mocked(execa).mockRejectedValueOnce(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    const missing = await TOOL_REGISTRY.spekta_shell.handler({ command: "ls" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain("not found");
  });
});
