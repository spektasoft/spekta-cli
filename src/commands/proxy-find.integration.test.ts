import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { confirm } from "@inquirer/prompts";
import { runRtkProxy } from "./proxy";
import { TOOL_REGISTRY } from "../api/mcp-server/registry";

vi.mock("execa", () => ({ execa: vi.fn() }));

vi.mock("@inquirer/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@inquirer/prompts")>()),
  confirm: vi.fn(),
}));

let fixture: string;
let workspace: string;
let savedExitCode: typeof process.exitCode;
let savedTtyDescriptor: PropertyDescriptor | undefined;

const listing = "./one.ts\n./space name/two.ts";
const secret = "ghp_abcdefghijklmnopqrstuvwxyz";

beforeEach(() => {
  vi.resetAllMocks();

  savedExitCode = process.exitCode;
  savedTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  process.exitCode = undefined;

  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "spekta-find-integration-"));
  workspace = path.join(fixture, "workspace");

  fs.ensureDirSync(path.join(workspace, "directory"));
  fs.ensureDirSync(path.join(workspace, "space name"));
  fs.ensureDirSync(path.join(workspace, "-directory"));
  fs.ensureDirSync(path.join(workspace, ".env"));
  fs.ensureDirSync(path.join(fixture, "outside"));

  fs.writeFileSync(path.join(workspace, "file.txt"), "file");
  fs.writeFileSync(path.join(workspace, "sentinel.txt"), "preserve this file");
  fs.writeFileSync(
    path.join(fixture, "outside", "external-sentinel.txt"),
    "preserve external file",
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
  fs.symlinkSync(
    path.join(workspace, "missing"),
    path.join(workspace, "dangling"),
    "dir",
  );

  vi.spyOn(process, "cwd").mockReturnValue(workspace);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  vi.mocked(execa).mockResolvedValue({
    stdout: listing,
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

async function expectRejected(args: string[], reason: RegExp): Promise<void> {
  const original = [...args];

  await runRtkProxy("find", args);

  const cli: unknown = vi.mocked(console.error).mock.calls.at(-1)?.[0];
  if (typeof cli !== "string") {
    throw new Error("Expected a string CLI rejection diagnostic.");
  }

  const mcp = await TOOL_REGISTRY.spekta_shell.handler({
    command: "find",
    args,
  });

  expect(cli).toMatch(reason);
  expect(cli).not.toContain(secret);
  expect(process.exitCode).toBe(1);
  expect(console.log).not.toHaveBeenCalled();

  expect(mcp).toEqual({
    isError: true,
    content: [{ type: "text", text: cli }],
  });

  // These are external boundaries, not internal collaborators.
  expect(execa).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  expect(args).toEqual(original);
}

describe("restricted find CLI and MCP parity", () => {
  it.each([
    {
      args: [],
      expectedArgs: ["proxy", "find", "-P", "."],
    },
    {
      args: ["."],
      expectedArgs: ["proxy", "find", "-P", "."],
    },
    {
      args: ["-type", "f", "-name", "*.ts"],
      expectedArgs: ["proxy", "find", "-P", ".", "-type", "f", "-name", "*.ts"],
    },
    {
      args: [".", "-type", "f", "-name", "*.ts"],
      expectedArgs: ["proxy", "find", "-P", ".", "-type", "f", "-name", "*.ts"],
    },
    {
      args: [".", "-name", "*.ts", "-type", "f"],
      expectedArgs: ["proxy", "find", "-P", ".", "-name", "*.ts", "-type", "f"],
    },
    {
      args: ["directory", "-type", "d", "-print"],
      expectedArgs: [
        "proxy",
        "find",
        "-P",
        "directory",
        "-type",
        "d",
        "-print",
      ],
    },
    {
      args: ["space name", "-name", "file name.ts", "-print"],
      expectedArgs: [
        "proxy",
        "find",
        "-P",
        "space name",
        "-name",
        "file name.ts",
        "-print",
      ],
    },
    {
      args: ["./-directory", "-name", "-exec"],
      expectedArgs: ["proxy", "find", "-P", "./-directory", "-name", "-exec"],
    },
    {
      args: [".", "-name", "../outside/*.ts"],
      expectedArgs: ["proxy", "find", "-P", ".", "-name", "../outside/*.ts"],
    },
    {
      args: [".", "-name", ".env"],
      expectedArgs: ["proxy", "find", "-P", ".", "-name", ".env"],
    },
  ])(
    "executes accepted request $args through equivalent public adapters",
    async ({ args, expectedArgs }) => {
      const original = [...args];

      await runRtkProxy("find", args);
      const mcp = await TOOL_REGISTRY.spekta_shell.handler({
        command: "find",
        args,
      });

      expect(execa).toHaveBeenCalledTimes(2);
      expect(execa).toHaveBeenNthCalledWith(
        1,
        "rtk",
        expectedArgs,
        expect.objectContaining({
          reject: false,
          cwd: workspace,
          env: expect.objectContaining({
            NO_COLOR: "1",
            TERM: "dumb",
          }) as unknown,
        }),
      );
      expect(execa).toHaveBeenNthCalledWith(
        2,
        "rtk",
        expectedArgs,
        expect.objectContaining({
          reject: false,
          cwd: workspace,
          env: expect.objectContaining({
            NO_COLOR: "1",
            TERM: "dumb",
          }) as unknown,
        }),
      );

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("### spekta find"),
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(listing),
      );
      expect(console.error).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();

      expect(mcp).toEqual({
        isError: false,
        content: [{ type: "text", text: listing }],
      });

      expect(confirm).not.toHaveBeenCalled();
      expect(args).toEqual(original);
    },
  );

  it("uses the default root when MCP args are omitted", async () => {
    const result = await TOOL_REGISTRY.spekta_shell.handler({
      command: "find",
    });

    expect(execa).toHaveBeenCalledWith(
      "rtk",
      ["proxy", "find", "-P", "."],
      expect.objectContaining({
        reject: false,
        cwd: workspace,
      }),
    );
    expect(result).toEqual({
      isError: false,
      content: [{ type: "text", text: listing }],
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "rejects unsupported grammar without execution or prompting with isTTY=%s",
    async (isTTY) => {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: isTTY,
      });

      const requests: Array<{ args: string[]; reason: RegExp }> = [
        { args: [".", "-iname", "*.ts"], reason: /unsupported find token/i },
        { args: [".", "-regex", ".*"], reason: /unsupported find token/i },
        { args: [".", "-path", "./*"], reason: /unsupported find token/i },
        {
          args: [".", "-type", "f", "-o", "-type", "d"],
          reason: /unsupported find token/i,
        },
        { args: [".", "-a", "-type", "f"], reason: /unsupported find token/i },
        {
          args: [".", "!", "-name", "*.ts"],
          reason: /unsupported find token/i,
        },
        {
          args: [".", "(", "-name", "*.ts", ")"],
          reason: /unsupported find token/i,
        },
        { args: [".", "-L"], reason: /unsupported find token/i },
        { args: ["-H", "."], reason: /unsupported find token/i },
        { args: ["-P", "."], reason: /unsupported find token/i },
        { args: [".", "-follow"], reason: /unsupported find token/i },
        { args: [".", "-depth"], reason: /unsupported find token/i },
        { args: [".", "-maxdepth", "1"], reason: /unsupported find token/i },
        { args: [".", "-prune"], reason: /unsupported find token/i },
        { args: [".", "-quit"], reason: /unsupported find token/i },
        { args: [".", "-print0"], reason: /unsupported find token/i },
        { args: [".", "-printf", "%p"], reason: /unsupported find token/i },
        { args: [".", "-type"], reason: /find -type requires/i },
        { args: [".", "-type", "l"], reason: /find -type requires/i },
        { args: [".", "-name"], reason: /nonempty pattern/i },
        { args: [".", "-name", ""], reason: /nonempty pattern/i },
        {
          args: [".", "-type", "f", "-type", "d"],
          reason: /duplicate find -type/i,
        },
        {
          args: [".", "-name", "*.ts", "-name", "*.js"],
          reason: /duplicate find -name/i,
        },
        { args: [".", "-print", "-type", "f"], reason: /terminal -print/i },
        { args: [".", "-print", "-print"], reason: /terminal -print/i },
        { args: [".", "directory"], reason: /unsupported find token/i },
        {
          args: ["directory/../directory"],
          reason: /unsupported find root syntax/i,
        },
        { args: ["directory/"], reason: /unsupported find root syntax/i },
        {
          args: [".", "-name", "bad\npattern"],
          reason: /invalid find argument/i,
        },
        {
          args: [".", "--spekta-force"],
          reason: /unsupported option.*--spekta-force/i,
        },
        {
          args: [".", "-name", "--spekta-force"],
          reason: /unsupported option.*--spekta-force/i,
        },
      ];

      for (const request of requests) {
        await expectRejected(request.args, request.reason);
      }
    },
  );

  it.each([
    { args: [".", "-exec", "touch", "marker", ";"] },
    { args: [".", "-execdir", "touch", "marker", ";"] },
    { args: [".", "-ok", "touch", "marker", ";"] },
    { args: [".", "-okdir", "touch", "marker", ";"] },
    { args: [".", "-delete"] },
    { args: [".", "-fprint", "output.txt"] },
    { args: [".", "-fprint0", "output.txt"] },
    { args: [".", "-fprintf", "output.txt", "%p"] },
    { args: [".", "-fls", "output.txt"] },
  ])(
    "rejects side-effect action $args and preserves files",
    async ({ args }) => {
      await expectRejected(args, /unsupported find token/i);

      expect(
        fs.readFileSync(path.join(workspace, "sentinel.txt"), "utf8"),
      ).toBe("preserve this file");
      expect(
        fs.readFileSync(
          path.join(fixture, "outside", "external-sentinel.txt"),
          "utf8",
        ),
      ).toBe("preserve external file");

      expect(fs.existsSync(path.join(workspace, "marker"))).toBe(false);
      expect(fs.existsSync(path.join(workspace, "output.txt"))).toBe(false);
      expect(fs.existsSync(path.join(fixture, "outside", "marker"))).toBe(
        false,
      );
      expect(fs.existsSync(path.join(fixture, "outside", "output.txt"))).toBe(
        false,
      );
    },
  );

  it("rejects external and escaping symlink roots identically", async () => {
    const roots = [
      "../outside",
      path.join(fixture, "outside"),
      workspace,
      "C:/outside",
      String.raw`C:\outside`,
      String.raw`\\server\share\outside`,
      "escape",
      "escape/missing/child",
    ];

    for (const root of roots) {
      await expectRejected([root], /outside the project directory/i);
    }
  });

  it.each([".env", ".env/child", "restricted-alias"])(
    "rejects restricted root %s identically",
    async (root) => {
      await expectRejected([root], /restricted/i);
    },
  );

  it.each(["file.txt", "missing", "dangling"])(
    "rejects non-directory root %s identically",
    async (root) => {
      await expectRejected([root], /existing workspace directory/i);
    },
  );

  it("rejects a restricted default cwd in both adapters", async () => {
    vi.spyOn(process, "cwd").mockImplementation(() =>
      path.join(workspace, ".env"),
    );
    await expectRejected([], /restricted/i);
  });

  it("rejects inaccessible directory inspection in both adapters", async () => {
    vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });
    await expectRejected(["directory"], /existing workspace directory/i);
  });

  it("redacts canonical lookup failures in both adapters before execution", async () => {
    vi.spyOn(fs, "realpathSync").mockImplementation(() => {
      throw new Error(secret);
    });
    await expectRejected(["directory"], /\[REDACTED\]/);
  });

  it("preserves the existing missing-RTK advisory behavior", async () => {
    vi.mocked(execa).mockRejectedValue(
      Object.assign(new Error("rtk not found"), { code: "ENOENT" }),
    );

    await runRtkProxy("find", ["."]);
    const mcp = await TOOL_REGISTRY.spekta_shell.handler({
      command: "find",
      args: ["."],
    });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("### spekta rtk unavailable"),
    );
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();

    expect(mcp).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "The `rtk` executable was not found. Install RTK with the `rtk-ai` package, then retry.",
        },
      ],
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("preserves existing backend-failure reporting in both adapters", async () => {
    vi.mocked(execa).mockResolvedValue({
      stdout: "",
      stderr: "native find failed",
      exitCode: 1,
    } as never);

    await runRtkProxy("find", ["."]);
    const mcp = await TOOL_REGISTRY.spekta_shell.handler({
      command: "find",
      args: ["."],
    });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("native find failed"),
    );
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    expect(mcp).toEqual({
      isError: true,
      content: [{ type: "text", text: "native find failed" }],
    });
    expect(confirm).not.toHaveBeenCalled();
  });
});
