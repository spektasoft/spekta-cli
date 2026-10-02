import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { confirm } from "@inquirer/prompts";
import { runRtkProxy } from "./proxy";
import { TOOL_REGISTRY } from "../../api/mcp-server/registry";
import { getTokenCount } from "../../utils/read-utils";
import {
  acceptedGitRequests,
  rejectedGitRequests,
} from "./proxy-git.test-fixtures";

vi.mock("execa", () => ({ execa: vi.fn() }));
vi.mock("@inquirer/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@inquirer/prompts")>()),
  confirm: vi.fn(),
}));

let fixture: string;
let workspace: string;
let savedExitCode: typeof process.exitCode;
let savedGitOverrides: Record<string, string | undefined>;
let savedTtyDescriptor: PropertyDescriptor | undefined;
const secret = "ghp_abcdefghijklmnopqrstuvwxyz";

beforeEach(() => {
  vi.resetAllMocks();
  savedExitCode = process.exitCode;
  savedGitOverrides = {};
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) {
    savedGitOverrides[key] = process.env[key];
    delete process.env[key];
  }
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
  fs.ensureDirSync(path.join(workspace, ".git"));
  fs.symlinkSync(
    path.join(workspace, "missing"),
    path.join(workspace, "dangling"),
    "dir",
  );
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
  for (const [key, value] of Object.entries(savedGitOverrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
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

  it.each(acceptedGitRequests.map((args) => ({ args })))(
    "executes Git $args with equivalent adapter policy",
    async ({ args }) => {
      const original = [...args];
      await runRtkProxy("git", args);
      const mcp = await TOOL_REGISTRY.spekta_shell.handler({
        command: "git",
        args,
      });
      const history = ["log", "show", "diff"].includes(args[0]);
      const expected = [
        "proxy",
        "git",
        "--no-pager",
        "--literal-pathspecs",
        ...(args[0] === "diff" ? ["-c", "diff.autoRefreshIndex=false"] : []),
        args[0],
        ...(history ? ["--no-ext-diff", "--no-textconv"] : []),
        ...(args[0] === "diff" ? ["--submodule=short"] : []),
        ...args.slice(1),
        ...(history && !args.includes("--") ? ["--"] : []),
      ];
      const calls = vi.mocked(execa).mock.calls as unknown as Array<
        [string, string[], { cwd?: string; env?: NodeJS.ProcessEnv }]
      >;
      for (const call of calls) {
        expect(call[0]).toBe("rtk");
        expect(call[1]).toEqual(expected);
        expect(call[2]).toEqual(
          expect.objectContaining({
            cwd: workspace,
            env: expect.objectContaining({
              GIT_PAGER: "cat",
              PAGER: "cat",
            }) as Record<string, unknown>,
          }),
        );
      }
      expect(vi.mocked(execa).mock.calls).toHaveLength(2);
      expect(args).toEqual(original);
      expect(mcp).toEqual({
        isError: false,
        content: [{ type: "text", text: "listing" }],
      });
      expect(console.error).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
    },
  );

  it.each(["status", "log", "show", "diff", "branch"])(
    "condenses and redacts %s output in both adapters",
    async (subcommand) => {
      vi.mocked(execa).mockResolvedValue({
        stdout: `${secret}\n${"history line\n".repeat(3000)}`,
        stderr: "",
        exitCode: 0,
      } as never);
      await runRtkProxy("git", [subcommand]);
      const mcp = await TOOL_REGISTRY.spekta_shell.handler({
        command: "git",
        args: [subcommand],
      });
      const cli = vi.mocked(console.log).mock.calls[0][0] as string;
      expect(cli).toContain("OUTPUT TRUNCATED");
      expect(cli).not.toContain(secret);
      expect(mcp.content[0].text).toContain("lines collapsed");
      expect(mcp.content[0].text).not.toContain(secret);
      expect(getTokenCount(mcp.content[0].text)).toBeLessThanOrEqual(1000);
    },
  );

  it.each(["status", "log", "show", "diff", "branch"])(
    "fails closed for filesystem errors in %s",
    async (subcommand) => {
      vi.spyOn(fs, "realpathSync").mockImplementation(() => {
        throw new Error(`${secret} ${"failure ".repeat(3000)}`);
      });
      await expectRejected("git", [subcommand], /\[REDACTED\]/);
      expect(
        getTokenCount(vi.mocked(console.error).mock.calls[0][0] as string),
      ).toBeLessThanOrEqual(1000);
    },
  );

  it.each(["status", "log", "show", "diff", "branch"])(
    "preserves nonzero/missing RTK behavior for %s",
    async (subcommand) => {
      vi.mocked(execa).mockResolvedValue({
        stdout: "",
        stderr: secret,
        exitCode: 2,
      } as never);
      await runRtkProxy("git", [subcommand]);
      const failed = await TOOL_REGISTRY.spekta_shell.handler({
        command: "git",
        args: [subcommand],
      });
      expect(vi.mocked(console.log).mock.calls[0][0]).toContain(
        "FAILED: Exit 2",
      );
      expect(vi.mocked(console.log).mock.calls[0][0]).not.toContain(secret);
      expect(failed).toEqual({
        isError: true,
        content: [{ type: "text", text: "[REDACTED]" }],
      });
      vi.mocked(execa).mockRejectedValue(
        Object.assign(new Error("missing"), { code: "ENOENT" }),
      );
      await runRtkProxy("git", [subcommand]);
      expect(vi.mocked(console.log).mock.calls.at(-1)?.[0]).toContain(
        "not found",
      );
      const missing = await TOOL_REGISTRY.spekta_shell.handler({
        command: "git",
        args: [subcommand],
      });
      expect(missing.isError).toBe(true);
      expect(missing.content[0].text).toContain("not found");
    },
  );

  it.each(["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"])(
    "rejects ambient %s through both adapters",
    async (key) => {
      process.env[key] = "override";
      for (const subcommand of ["status", "diff", "branch"]) {
        await expectRejected("git", [subcommand], /workspace override/i);
      }
    },
  );

  it("rejects restricted cwd without path operands through both adapters", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(path.join(workspace, ".env"));
    for (const subcommand of ["status", "log", "show", "diff", "branch"])
      await expectRejected("git", [subcommand], /restricted/i);
  });

  it.each(["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"])(
    "rejects ambient %s for explicit branch listing, including empty values",
    async (key) => {
      for (const value of ["", "override"]) {
        process.env[key] = value;
        await expectRejected(
          "git",
          ["branch", "--list", "feature/*"],
          /workspace override/i,
        );
      }
    },
  );

  it("propagates branch subprocess launch failures through both adapters", async () => {
    const failure = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    vi.mocked(execa).mockRejectedValue(failure);
    await expect(runRtkProxy("git", ["branch"])).rejects.toBe(failure);
    await expect(
      TOOL_REGISTRY.spekta_shell.handler({ command: "git", args: ["branch"] }),
    ).rejects.toBe(failure);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("rejects missing blob root through both adapters", async () => {
    fs.removeSync(path.join(workspace, ".git"));
    await expectRejected("git", ["show", "HEAD:file.txt"], /cannot establish/i);
  });

  it("rejects a symlink repository marker through both adapters", async () => {
    fs.removeSync(path.join(workspace, ".git"));
    fs.symlinkSync(
      path.join(fixture, "outside"),
      path.join(workspace, ".git"),
      "dir",
    );
    await expectRejected(
      "git",
      ["show", "HEAD:file.txt"],
      /repository marker/i,
    );
  });

  it("rejects a blob outside nested cwd before RTK starts", async () => {
    const nested = path.join(workspace, "nested");
    fs.ensureDirSync(nested);
    vi.spyOn(process, "cwd").mockReturnValue(nested);
    await expectRejected(
      "git",
      ["show", "HEAD:file.txt"],
      /outside the project directory/i,
    );
  });

  it("rejects blob marker I/O failure with a redacted diagnostic", async () => {
    vi.spyOn(fs, "lstatSync").mockImplementation(() => {
      throw new Error(secret);
    });
    await expectRejected("git", ["show", "HEAD:file.txt"], /\[REDACTED\]/);
  });

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
        ["git", ["reset"], /unsupported Git subcommand/i],
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
      requests.push(
        ...rejectedGitRequests.map(
          ([args, reason]): [string, string[], RegExp] => ["git", args, reason],
        ),
      );
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
